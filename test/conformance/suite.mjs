import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCommand } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const cliEntry = path.join(repoRoot, "packages", "skeem", "dist", "bin", "skeem.js");

/**
 * Run the cross-adapter contract suite against a started fixture.
 *
 * The fixture owns everything backend-specific: `connection` ({ url, token }),
 * `tier` ("full" | "data"), and `seedCollection`/`seedRelation` which the suite
 * uses to provision a known baseline. Every skeem-level scenario and assertion
 * below is backend-agnostic.
 */
export async function runConformanceSuite(fixture) {
  const workDir = path.join(repoRoot, "test", ".tmp", `conformance-${fixture.name}`);
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  // Drive every command through a local config so each adapter is selected by
  // name and gets its full connection (token, or email/password, or base id).
  // The fixture name doubles as the adapter name in the registry.
  await writeFile(path.join(workDir, ".skeemrc.yaml"), JSON.stringify({
    adapter: fixture.name,
    connection: fixture.connection,
  }, null, 2));

  const runSkeemJson = (args, options = {}) => {
    const cli = runCommand("node", [
      cliEntry,
      ...args,
      "--json",
    ], { cwd: workDir, ...(options.input ? { input: `${options.input}\n` } : {}) });
    if (!options.expectFailure && cli.status !== 0) {
      throw new Error(`skeem ${args[0]} failed:\n${cli.stderr || cli.stdout}`);
    }
    try {
      return JSON.parse(cli.stdout);
    } catch (error) {
      throw new Error(`Failed to parse CLI JSON for ${args.join(" ")}:\n${cli.stdout}\n${error}`);
    }
  };

  const results = {};

  // Baseline schema, seeded via the fixture (backend-specific underneath).
  await fixture.seedCollection("companies", [
    { name: "name", type: "string", required: true, unique: true },
    { name: "industry", type: "string" },
  ]);
  await fixture.seedCollection("people", [
    { name: "name", type: "string", required: true },
  ]);
  await fixture.seedCollection("widgets", [
    { name: "name", type: "string" },
  ]);
  await fixture.seedRelation({ collectionMany: "people", collectionOne: "companies", field: "company" });

  // ---- Discovery (all tiers) ----
  const ls = runSkeemJson(["ls", "--counts"]);
  assert(ls.ok && Array.isArray(ls.data), "ls returns a collection list", ls);
  for (const name of ["companies", "people", "widgets"]) {
    const entry = ls.data.find((c) => c.collection === name);
    assert(entry && typeof entry.count === "number", `ls includes "${name}" with a numeric count`, ls);
  }
  results.ls = true;

  const describe = runSkeemJson(["describe", "companies"]);
  assert(describe.ok && describe.data?.fields?.some((f) => f.name === "name"), "describe surfaces fields", describe);
  results.describe = true;

  const discover = runSkeemJson(["discover"]);
  assert(discover.ok && discover.data?.collections?.companies, "discover returns collections", discover);
  const peopleRelations = discover.data.collections.people?.relations ?? {};
  const m2oToCompanies = Object.values(peopleRelations).some((r) => r.type === "m2o" && r.collection === "companies");
  assert(m2oToCompanies, "discover reconstructs the people->companies m2o relation", discover);
  results.discover = true;
  results.relationIntrospect = true;

  // ---- CRUD (all tiers) ----
  const created = runSkeemJson(["create", "companies", "--name", "Conformance Co", "--industry", "Testing"]);
  assert(created.ok && created.data?.name === "Conformance Co", "create returns the new record", created);
  const id = created.data.id ?? created.data[Object.keys(created.data)[0]];
  const companyId = created.data.id;
  assert(companyId !== undefined, "create returns a primary key", created);

  const got = runSkeemJson(["get", "companies", String(companyId)]);
  assert(got.ok && got.data?.name === "Conformance Co", "get returns the record", got);
  results.get = true;

  const found = runSkeemJson(["find", "companies", "--where", "name=Conformance Co"]);
  assert(found.ok && found.count === 1, "find filters by equality", found);
  results.find = true;

  const updated = runSkeemJson(["update", "companies", String(companyId), "--industry", "Robotics"]);
  assert(updated.ok && updated.data?.industry === "Robotics", "update persists changes", updated);
  results.update = true;

  const deleted = runSkeemJson(["delete", "companies", String(companyId), "--hard"]);
  assert(deleted.ok, "hard delete succeeds", deleted);
  results.create = true;
  results.delete = true;
  void id;

  // ---- diff round-trip to clean (all tiers) ----
  const discoverFile = path.join(workDir, "schema.skeem.yaml");
  const discoverToFile = runSkeemJson(["discover", "-o", discoverFile]);
  assert(discoverToFile.ok, "discover -o writes a schema document", discoverToFile);
  const diffSelf = runSkeemJson(["diff", discoverFile]);
  assert(diffSelf.ok && diffSelf.data?.summary?.totalChanges === 0, "a discovered schema diffs clean against itself", diffSelf);
  results.diffSelf = true;

  if (fixture.tier !== "full") {
    return results;
  }

  // ---- define: collection + enum field (full tier) ----
  // Re-discover so the base reflects any system tables a prior write may have
  // lazily provisioned; otherwise the post-define diff would flag them as drift.
  const defineBase = runSkeemJson(["discover"]);
  const defineDoc = JSON.parse(JSON.stringify(defineBase.data));
  defineDoc.collections.projects = {
    fields: {
      code: { type: "string", unique: true },
      name: { type: "string", required: true },
    },
  };
  defineDoc.collections.widgets.fields.status = { type: "string", enum: ["draft", "published"] };
  const definePath = path.join(workDir, "define.skeem.yaml");
  await writeFile(definePath, JSON.stringify(defineDoc, null, 2));

  const dryRun = runSkeemJson(["define", definePath, "--dry-run"]);
  assert(dryRun.ok && Array.isArray(dryRun.plan) && dryRun.plan.length > 0, "define --dry-run produces a plan", dryRun);
  assert(
    dryRun.plan.some((e) => e.action === "create_collection" && e.collection === "projects"),
    "plan creates the projects collection",
    dryRun,
  );
  assert(
    dryRun.plan.some((e) => e.action === "create_field" && e.collection === "widgets" && e.field === "status"),
    "plan creates the enum field",
    dryRun,
  );

  const applied = runSkeemJson(["define", definePath, "--yes"]);
  assert(applied.ok && applied.data?.summary?.applied > 0, "define --yes applies the plan", applied);
  results.define = true;

  const diffAfter = runSkeemJson(["diff", definePath]);
  assert(diffAfter.ok && diffAfter.data?.summary?.totalChanges === 0, "define resolves all drift", diffAfter);
  results.defineRoundTrip = true;

  const rediscover = runSkeemJson(["discover"]);
  const statusEnum = rediscover.data?.collections?.widgets?.fields?.status?.enum;
  assert(
    Array.isArray(statusEnum) && [...statusEnum].sort().join(",") === "draft,published",
    "discover surfaces the enum choices after define",
    rediscover,
  );
  results.enumRoundTrip = true;

  // ---- init + a basic claim (full tier) ----
  const initStatus = runSkeemJson(["init", "--status"]);
  assert(initStatus.ok && Array.isArray(initStatus.data), "init --status reports system tables", initStatus);
  const initApply = runSkeemJson(["init"]);
  assert(initApply.ok, "init succeeds", initApply);
  // Robust to system tables that a prior write may have lazily provisioned:
  // assert they all exist afterward rather than that init created them now.
  const initStatusAfter = runSkeemJson(["init", "--status"]);
  const systemTables = ["skeem_provenance", "skeem_claims", "skeem_annotations", "skeem_versions", "skeem_trash", "skeem_aliases"];
  const allExist = systemTables.every((t) => initStatusAfter.data?.find((e) => e.collection === t)?.exists === true);
  assert(allExist, "all system tables exist after init", initStatusAfter);
  results.init = true;

  const claimTarget = runSkeemJson(["create", "companies", "--name", "Claim Co"]);
  const claimId = claimTarget.data?.id;
  const claim = runSkeemJson(["claim", `companies:${claimId}`, "--lease", "5m", "--purpose", "conformance"]);
  assert(claim.ok, "claim acquires a lease", claim);
  const claims = runSkeemJson(["claims", `companies:${claimId}`]);
  assert(claims.ok && claims.data?.claim?.purpose === "conformance", "claims reports the active claim", claims);
  const release = runSkeemJson(["release", `companies:${claimId}`]);
  assert(release.ok, "release frees the claim", release);
  if (claimId !== undefined) {
    runSkeemJson(["delete", "companies", String(claimId), "--hard"]);
  }
  results.claims = true;

  return results;
}

function assert(condition, label, payload) {
  if (!condition) {
    throw new Error(`Conformance check failed: ${label}\n${JSON.stringify(payload, null, 2)}`);
  }
}
