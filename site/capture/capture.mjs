#!/usr/bin/env node

// Capture real skeem output for the site demos. Boots the shared Directus
// fixture, provisions the demo collections, writes a demo workspace, then runs
// each scenario's real commands (reference scenarios hit live public APIs from
// a clean temp dir; Directus scenarios run against the local fixture) and
// writes site/public/scenarios/<id>.json for the terminal widget to replay.
//
//   npm run site:capture            # all scenarios
//   node site/capture/capture.mjs --only enrich-create
//
// Requires: a prior build (the root script runs `npm run build` first) and jq.
// No API keys needed — every scenario uses no-auth reference adapters.

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bootDirectusFixture } from "../../test/smoke/directus-fixture.mjs";
import { scenarios } from "./scenarios.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const skeemBin = path.join(repoRoot, "packages", "skeem", "dist", "bin", "skeem.js");
const outDir = path.join(repoRoot, "site", "public", "scenarios");

const onlyArg = process.argv.indexOf("--only");
const onlyId = onlyArg !== -1 ? process.argv[onlyArg + 1] : undefined;

const PLAN_JSON = JSON.stringify(
  {
    operations: [
      { ref: "company", op: "upsert", collection: "companies", match: { name: "Acme" }, data: { industry: "Robotics" } },
      { ref: "root", op: "create", collection: "people", data: { name: "Mia", company_id: "$company.id" } },
    ],
  },
  null,
  2,
);

function jqAvailable() {
  return spawnSync("jq", ["--version"], { encoding: "utf8" }).status === 0;
}

async function skeemVersion() {
  try {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, "packages", "skeem", "package.json"), "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Run the built skeem CLI, optionally piping stdout through jq. */
function runStep(step, cwd, env) {
  const started = Date.now();
  const skeem = spawnSync("node", [skeemBin, ...step.run], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    ...(step.stdin ? { input: step.stdin } : {}),
  });
  let output = skeem.stdout ?? "";
  let exitCode = skeem.status ?? 0;

  if (step.pipe) {
    const jq = spawnSync("jq", [step.pipe], { input: output, encoding: "utf8" });
    if (jq.status !== 0) {
      throw new Error(`jq failed for step "${step.display}":\n${jq.stderr}\ninput was:\n${output}`);
    }
    output = jq.stdout;
  }

  const durationMs = Date.now() - started;
  return { output: output.trimEnd(), exitCode, stderr: skeem.stderr ?? "", durationMs };
}

function scrub(text, token) {
  let out = text;
  if (token) out = out.split(token).join("${DIRECTUS_TOKEN}");
  return out
    .replace(new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "~/skeem")
    .replace(/\/Users\/[^/\s"]+/g, "~");
}

async function captureScenario(scenario, ctx) {
  const { fixtureWorkspace, baseUrl, adminToken, displaySkeemrc } = ctx;
  console.log(`\n▶ ${scenario.id}`);

  const cwd = scenario.backend === "directus" ? fixtureWorkspace : await mkdtemp(path.join(tmpdir(), "skeem-demo-"));
  const env = scenario.backend === "directus" ? { SKEEM_DEMO_TOKEN: adminToken } : {};

  const steps = [];
  for (const step of scenario.steps) {
    let output;
    let exitCode = 0;
    let durationMs = 0;

    if (step.catFile) {
      output = step.catFile === "plan.json" ? PLAN_JSON : await readFile(path.join(cwd, step.catFile), "utf8");
    } else {
      const stepToRun = step.stdinFile ? { ...step, stdin: PLAN_JSON } : step;
      const expected = step.expectExit ?? 0;
      // Live reference APIs occasionally rate-limit under rapid capture; pace and
      // retry success-expecting steps so the recording stays a real success.
      const live = scenario.liveApis.length > 0;
      const maxAttempts = live && expected === 0 ? 3 : 1;
      let result;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (live) await sleep(1500);
        result = runStep(stepToRun, cwd, env);
        if (result.exitCode === expected) break;
        if (attempt === maxAttempts) {
          throw new Error(`${scenario.id}: "${step.display}" exited ${result.exitCode}, expected ${expected}\n${result.stderr}\n${result.output}`);
        }
        await sleep(2500 * attempt);
      }
      output = result.output;
      exitCode = result.exitCode;
      durationMs = result.durationMs;
    }

    output = scrub(output, adminToken);
    if (output.includes("/Users/")) throw new Error(`${scenario.id}: a /Users/ path leaked into output`);

    steps.push({
      ...(step.comment ? { comment: step.comment } : {}),
      command: step.display,
      output,
      exitCode,
      durationMs,
      outputFormat: looksJson(output) ? "json" : "text",
      ...(step.foldAfter ? { foldAfter: step.foldAfter } : {}),
      ...(step.highlight ? { highlight: step.highlight } : {}),
      ...(step.note ? { note: step.note } : {}),
    });
  }

  if (scenario.backend !== "directus") await rm(cwd, { recursive: true, force: true });

  return {
    id: scenario.id,
    title: scenario.title,
    tagline: scenario.tagline,
    skeemVersion: ctx.version,
    capturedAt: ctx.capturedAt,
    env: {
      backend: scenario.backend === "directus" ? `Directus (local fixture)` : null,
      liveApis: scenario.liveApis,
      skeemrc: scenario.backend === "directus" ? displaySkeemrc : null,
    },
    steps,
  };
}

function looksJson(text) {
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setupFixture(fx) {
  const { ensureCollection, ensureRelation, createItemDirect, stringField, integerField, jsonField } = fx;

  await ensureCollection({ name: "movies", fields: [stringField("title"), stringField("release_date"), stringField("overview"), stringField("imdb_id")] });
  await ensureCollection({ name: "companies", fields: [stringField("name", { required: true, unique: true }), stringField("industry")] });
  await ensureCollection({ name: "people", fields: [stringField("name", { required: true }), integerField("company_id")] });
  await ensureRelation({ collectionMany: "people", fieldMany: "company_id", collectionOne: "companies" });
  await ensureCollection({ name: "books", fields: [stringField("title"), stringField("authors"), stringField("isbn_13"), integerField("number_of_pages"), jsonField("subjects")] });
  await ensureCollection({ name: "products", fields: [stringField("sku", { unique: true }), stringField("name"), floatField("price")] });
  await ensureCollection({ name: "order_lines", fields: [stringField("order_ref"), integerField("qty"), stringField("product_name"), floatField("unit_price")] });

  // Seed deterministic rows (DB is reset each run, so ids start at 1).
  await createItemDirect("movies", { title: "Placeholder", overview: "Seeded so claims can lease movies:1." });
  await createItemDirect("products", { sku: "WIDGET-9", name: "Hyperdrive Widget", price: 19.99 });
}

function floatField(name) {
  return {
    field: name,
    type: "float",
    meta: { interface: "input", width: "full" },
    schema: { name, data_type: "float", is_nullable: true },
  };
}

async function main() {
  if (!jqAvailable()) {
    throw new Error("jq is required for capture (brew install jq). It trims huge reference payloads honestly.");
  }
  const version = await skeemVersion();
  const capturedAt = new Date().toISOString();
  const selected = onlyId ? scenarios.filter((s) => s.id === onlyId) : scenarios;
  if (selected.length === 0) throw new Error(`No scenario matches --only ${onlyId}`);

  const needsDirectus = selected.some((s) => s.backend === "directus");
  await mkdir(outDir, { recursive: true });

  let fx;
  const ctx = { version, capturedAt };
  try {
    if (needsDirectus) {
      console.log("Booting Directus fixture…");
      fx = await bootDirectusFixture();
      await setupFixture(fx);

      const workspace = path.join(fx.fixtureRoot, "demo-workspace");
      await mkdir(workspace, { recursive: true });
      await writeFile(
        path.join(workspace, ".skeemrc.yaml"),
        [
          "adapter: directus",
          "cache:",
          "  ttl_ms: 600000",
          "connection:",
          `  url: "${fx.baseUrl}"`,
          '  token: "${SKEEM_DEMO_TOKEN}"',
          "sources:",
          "  wikidata: { adapter: wikidata }",
          "  openlibrary: { adapter: openlibrary }",
          "  musicbrainz: { adapter: musicbrainz }",
          "  self:",
          "    adapter: directus",
          "    connection:",
          `      url: "${fx.baseUrl}"`,
          '      token: "${SKEEM_DEMO_TOKEN}"',
        ].join("\n"),
      );
      await writeFile(path.join(workspace, "plan.json"), PLAN_JSON);

      ctx.fixtureWorkspace = workspace;
      ctx.baseUrl = fx.baseUrl;
      ctx.adminToken = fx.adminToken;
      ctx.displaySkeemrc = [
        "adapter: directus",
        "connection:",
        "  url: https://your-directus.example",
        "  token: ${DIRECTUS_TOKEN}",
        "sources:",
        "  wikidata: { adapter: wikidata }",
        "  openlibrary: { adapter: openlibrary }",
        "  musicbrainz: { adapter: musicbrainz }",
        "  self:",
        "    adapter: directus",
        "    connection:",
        "      url: https://your-directus.example",
        "      token: ${DIRECTUS_TOKEN}",
      ].join("\n");
    }

    const manifest = [];
    for (const scenario of selected) {
      const captured = await captureScenario(scenario, { ...ctx, adminToken: ctx.adminToken ?? "" });
      await writeFile(path.join(outDir, `${scenario.id}.json`), `${JSON.stringify(captured, null, 2)}\n`);
      manifest.push({ id: scenario.id, title: scenario.title, tagline: scenario.tagline, file: `${scenario.id}.json` });
      console.log(`  wrote ${scenario.id}.json (${captured.steps.length} steps)`);
    }

    // Only rewrite the manifest on a full run, so --only doesn't drop scenarios.
    if (!onlyId) {
      await writeFile(path.join(outDir, "index.json"), `${JSON.stringify({ scenarios: manifest }, null, 2)}\n`);
      console.log(`\nWrote index.json (${manifest.length} scenarios).`);
    }
  } finally {
    if (fx) await fx.stop();
  }
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
