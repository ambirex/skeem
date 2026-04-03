#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixtureRoot = path.join(repoRoot, "test", ".tmp", "directus-smoke");
const projectDir = path.join(fixtureRoot, "project");
const databaseDir = path.join(projectDir, "database");
const uploadsDir = path.join(projectDir, "uploads");
const extensionsDir = path.join(projectDir, "extensions");
const discoverOutputPath = path.join(fixtureRoot, "widgets.skeem.yaml");

const directusVersion = "11.17.1";
const sqliteVersion = "6.0.1";
const host = "127.0.0.1";
const port = 18055;
const baseUrl = `http://${host}:${port}`;
const adminEmail = "admin@example.com";
const adminPassword = "testpassword";
const adminToken = "skeem-admin-token";

let serverProcess;
let capturedStdout = "";
let capturedStderr = "";

try {
  await ensureFixtureProject();
  await stopExistingDirectus();
  await resetDatabase();
  await bootstrapDirectus();
  serverProcess = startDirectus();

  await waitForDirectus();
  await ensureCollection({
    name: "widgets",
    fields: [
      stringField("name"),
    ],
  });
  await ensureCollection({
    name: "companies",
    fields: [
      stringField("name", { required: true, unique: true }),
      stringField("industry"),
    ],
  });
  await ensureCollection({
    name: "people",
    fields: [
      stringField("name", { required: true }),
      integerField("company_id"),
    ],
  });
  await ensureRelation({
    collectionMany: "people",
    fieldMany: "company_id",
    collectionOne: "companies",
  });
  await clearSkeemCache();
  await rm(discoverOutputPath, { force: true });

  const lsBefore = await runSkeemJson(["ls", "--counts"]);
  const widgetsBefore = expectCollection(lsBefore, "widgets");
  if (widgetsBefore.count !== 0) {
    throw new Error(`Expected widgets count to start at 0 but received ${widgetsBefore.count}.`);
  }

  const cache = await runSkeemJson(["cache", "show"]);
  if (!cache.ok || !cache.data?.exists) {
    throw new Error(`Expected schema cache to exist after ls:\n${JSON.stringify(cache, null, 2)}`);
  }

  const described = await runSkeemJson(["describe", "widgets"]);
  if (!described.ok || described.collection !== "widgets") {
    throw new Error(`Describe failed:\n${JSON.stringify(described, null, 2)}`);
  }
  if (!Array.isArray(described.data?.fields) || !described.data.fields.some((field) => field.name === "name")) {
    throw new Error(`Describe did not include the widgets.name field:\n${JSON.stringify(described, null, 2)}`);
  }

  const discovered = await runSkeemJson(["discover", "widgets"]);
  if (!discovered.ok || discovered.operation !== "discover") {
    throw new Error(`Discover failed:\n${JSON.stringify(discovered, null, 2)}`);
  }
  if (!discovered.data?.collections?.widgets?.fields?.name) {
    throw new Error(`Discover did not include the widgets.name field:\n${JSON.stringify(discovered, null, 2)}`);
  }

  const discoveredToFile = await runSkeemJson(["discover", "widgets", "-o", discoverOutputPath]);
  if (!discoveredToFile.ok || discoveredToFile.data?.path !== discoverOutputPath) {
    throw new Error(`Discover file output failed:\n${JSON.stringify(discoveredToFile, null, 2)}`);
  }

  const discoveredFileContents = await readFile(discoverOutputPath, "utf8");
  if (!discoveredFileContents.includes("collections:") || !discoveredFileContents.includes("widgets:")) {
    throw new Error(`Discover output file did not look like schema YAML:\n${discoveredFileContents}`);
  }

  const dryRun = await runSkeemJson(["create", "people", "--name", "Dry Run", "--company.name", "Dry Run Co", "--dry-run"]);
  if (!dryRun.ok || dryRun.operation !== "dry_run" || !Array.isArray(dryRun.plan) || dryRun.plan.length !== 2) {
    throw new Error(`Dry-run relation preview failed:\n${JSON.stringify(dryRun, null, 2)}`);
  }
  if (dryRun.plan[0]?.collection !== "companies" || dryRun.plan[1]?.collection !== "people") {
    throw new Error(`Dry-run plan order was unexpected:\n${JSON.stringify(dryRun, null, 2)}`);
  }
  if (dryRun.plan[1]?.data?.company_id !== "$root_company.id") {
    throw new Error(`Dry-run root plan did not include relation placeholder:\n${JSON.stringify(dryRun, null, 2)}`);
  }

  const created = await runSkeemJson(["create", "widgets", "--name", "Alpha Widget"]);
  if (!created.ok || created.operation !== "create") {
    throw new Error(`Create failed:\n${JSON.stringify(created, null, 2)}`);
  }

  const widgetId = created.data?.id;
  if (typeof widgetId !== "number" && typeof widgetId !== "string") {
    throw new Error(`Create response did not include a usable id:\n${JSON.stringify(created, null, 2)}`);
  }

  const got = await runSkeemJson(["get", "widgets", String(widgetId)]);
  if (!got.ok || got.data?.name !== "Alpha Widget") {
    throw new Error(`Get failed or returned unexpected data:\n${JSON.stringify(got, null, 2)}`);
  }

  const found = await runSkeemJson(["find", "widgets", "--where", "name=Alpha Widget"]);
  if (!found.ok || found.count !== 1) {
    throw new Error(`Find failed or returned unexpected count:\n${JSON.stringify(found, null, 2)}`);
  }

  const updated = await runSkeemJson(["update", "widgets", String(widgetId), "--name", "Beta Widget"]);
  if (!updated.ok || updated.data?.name !== "Beta Widget") {
    throw new Error(`Update failed or returned unexpected data:\n${JSON.stringify(updated, null, 2)}`);
  }

  const foundUpdated = await runSkeemJson(["find", "widgets", "--where", "name=Beta Widget"]);
  if (!foundUpdated.ok || foundUpdated.count !== 1) {
    throw new Error(`Updated record was not discoverable:\n${JSON.stringify(foundUpdated, null, 2)}`);
  }

  const deleted = await runSkeemJson(["delete", "widgets", String(widgetId)]);
  if (!deleted.ok || deleted.operation !== "delete") {
    throw new Error(`Delete failed:\n${JSON.stringify(deleted, null, 2)}`);
  }

  const getAfterDelete = await runSkeemJson(["get", "widgets", String(widgetId)], { expectFailure: true });
  if (getAfterDelete.ok) {
    throw new Error(`Expected get to fail after delete:\n${JSON.stringify(getAfterDelete, null, 2)}`);
  }

  const findAfterDelete = await runSkeemJson(["find", "widgets", "--where", `id=${widgetId}`]);
  if (!findAfterDelete.ok || findAfterDelete.count !== 0) {
    throw new Error(`Expected deleted record to disappear from find results:\n${JSON.stringify(findAfterDelete, null, 2)}`);
  }

  const lsAfter = await runSkeemJson(["ls", "--counts"]);
  const widgetsAfter = expectCollection(lsAfter, "widgets");
  if (widgetsAfter.count !== 0) {
    throw new Error(`Expected widgets count to return to 0 but received ${widgetsAfter.count}.`);
  }

  const directCompany = await runSkeemJson(["create", "companies", "--name", "Direct Link Co"]);
  const directCompanyId = directCompany.data?.id;
  if (!directCompany.ok || (typeof directCompanyId !== "number" && typeof directCompanyId !== "string")) {
    throw new Error(`Failed to create direct-link company:\n${JSON.stringify(directCompany, null, 2)}`);
  }

  const directPerson = await runSkeemJson(["create", "people", "--name", "Direct Dana", "--company", `@${directCompanyId}`]);
  if (!directPerson.ok || directPerson.data?.company_id !== directCompanyId) {
    throw new Error(`@ relation create failed:\n${JSON.stringify(directPerson, null, 2)}`);
  }

  const nestedPerson = await runSkeemJson([
    "create",
    "people",
    "--name",
    "Nested Nora",
    "--company.name",
    "Nested Co",
    "--company.industry",
    "Technology",
  ]);
  if (!nestedPerson.ok || nestedPerson.operation !== "compound_create" || !Array.isArray(nestedPerson.plan) || nestedPerson.plan.length < 2) {
    throw new Error(`Dot notation create failed:\n${JSON.stringify(nestedPerson, null, 2)}`);
  }
  const nestedCompany = await runSkeemJson(["find", "companies", "--where", "name=Nested Co"]);
  if (!nestedCompany.ok || nestedCompany.count !== 1 || nestedCompany.data?.[0]?.industry !== "Technology") {
    throw new Error(`Nested company was not created correctly:\n${JSON.stringify(nestedCompany, null, 2)}`);
  }

  const resolvedPerson = await runSkeemJson([
    "create",
    "people",
    "--name",
    "Resolved Rita",
    "--company",
    "?name=Nested Co",
  ]);
  if (!resolvedPerson.ok || resolvedPerson.data?.company_id !== nestedCompany.data[0]?.id) {
    throw new Error(`? relation resolve failed:\n${JSON.stringify(resolvedPerson, null, 2)}`);
  }

  const resolveOrCreatePerson = await runSkeemJson([
    "create",
    "people",
    "--name",
    "Fallback Finn",
    "--company",
    "??name=Fallback Co",
    "--company.industry",
    "Services",
  ]);
  if (!resolveOrCreatePerson.ok) {
    throw new Error(`?? relation create failed:\n${JSON.stringify(resolveOrCreatePerson, null, 2)}`);
  }

  const fallbackCompanies = await runSkeemJson(["find", "companies", "--where", "name=Fallback Co"]);
  if (!fallbackCompanies.ok || fallbackCompanies.count !== 1 || fallbackCompanies.data?.[0]?.industry !== "Services") {
    throw new Error(`?? did not create fallback company correctly:\n${JSON.stringify(fallbackCompanies, null, 2)}`);
  }

  const resolveOrCreateAgain = await runSkeemJson([
    "create",
    "people",
    "--name",
    "Fallback Fern",
    "--company",
    "??name=Fallback Co",
    "--company.industry",
    "Ignored Update",
  ]);
  if (!resolveOrCreateAgain.ok) {
    throw new Error(`Second ?? relation create failed:\n${JSON.stringify(resolveOrCreateAgain, null, 2)}`);
  }

  const fallbackCompaniesAfterRepeat = await runSkeemJson(["find", "companies", "--where", "name=Fallback Co"]);
  if (!fallbackCompaniesAfterRepeat.ok || fallbackCompaniesAfterRepeat.count !== 1 || fallbackCompaniesAfterRepeat.data?.[0]?.industry !== "Services") {
    throw new Error(`?? should resolve existing company without mutating it:\n${JSON.stringify(fallbackCompaniesAfterRepeat, null, 2)}`);
  }

  const rollbackFailure = await runSkeemJson([
    "create",
    "people",
    "--company.name",
    "Rollback Co",
  ], { expectFailure: true });
  if (rollbackFailure.ok) {
    throw new Error(`Expected rollback fixture create to fail:\n${JSON.stringify(rollbackFailure, null, 2)}`);
  }

  const rollbackCompanies = await runSkeemJson(["find", "companies", "--where", "name=Rollback Co"]);
  if (!rollbackCompanies.ok || rollbackCompanies.count !== 0) {
    throw new Error(`Rollback did not clean up created child record:\n${JSON.stringify(rollbackCompanies, null, 2)}`);
  }

  const execPlan = {
    operations: [
      {
        ref: "updated_person",
        op: "update",
        collection: "people",
        id: "$person_a.id",
        data: {
          name: "Exec Alice Updated",
        },
      },
      {
        ref: "person_b_check",
        op: "get",
        collection: "people",
        id: "$person_b.id",
      },
      {
        ref: "person_a",
        op: "create",
        collection: "people",
        data: {
          name: "Exec Alice",
          company_id: "$company.id",
        },
      },
      {
        ref: "company",
        op: "create",
        collection: "companies",
        data: {
          name: "Exec Co",
          industry: "Automation",
        },
      },
      {
        ref: "person_b",
        op: "create",
        collection: "people",
        data: {
          name: "Exec Bob",
          company_id: "$company.id",
        },
      },
    ],
  };

  const execDryRun = await runSkeemJson(["exec", "--dry-run"], {
    stdin: JSON.stringify(execPlan),
  });
  if (!execDryRun.ok || execDryRun.operation !== "dry_run" || !Array.isArray(execDryRun.plan)) {
    throw new Error(`Exec dry-run failed:\n${JSON.stringify(execDryRun, null, 2)}`);
  }
  const execDryRunOrder = execDryRun.plan.map((entry) => entry.ref);
  if (execDryRunOrder.join(",") !== "company,person_a,updated_person,person_b,person_b_check") {
    throw new Error(`Exec dry-run order was unexpected:\n${JSON.stringify(execDryRun, null, 2)}`);
  }

  const execResult = await runSkeemJson(["exec"], {
    stdin: JSON.stringify(execPlan),
  });
  if (!execResult.ok || execResult.operation !== "exec" || !Array.isArray(execResult.plan) || execResult.plan.length !== 5) {
    throw new Error(`Exec failed:\n${JSON.stringify(execResult, null, 2)}`);
  }

  const execCompany = execResult.plan.find((entry) => entry.ref === "company");
  const execPersonAUpdated = execResult.plan.find((entry) => entry.ref === "updated_person");
  const execPersonBCheck = execResult.plan.find((entry) => entry.ref === "person_b_check");
  const execCompanyId = execCompany?.data?.id;

  if (execCompany?.data?.name !== "Exec Co") {
    throw new Error(`Exec did not create the company correctly:\n${JSON.stringify(execResult, null, 2)}`);
  }
  if (execPersonAUpdated?.data?.name !== "Exec Alice Updated") {
    throw new Error(`Exec did not update person A correctly:\n${JSON.stringify(execResult, null, 2)}`);
  }
  if (execPersonBCheck?.data?.name !== "Exec Bob" || execPersonBCheck?.data?.company_id !== execCompanyId) {
    throw new Error(`Exec get step did not resolve person B correctly:\n${JSON.stringify(execResult, null, 2)}`);
  }

  const execPeopleByName = await runSkeemJson(["find", "people", "--where", "name=Exec Alice Updated"]);
  if (!execPeopleByName.ok || execPeopleByName.count !== 1) {
    throw new Error(`Updated exec person was not discoverable:\n${JSON.stringify(execPeopleByName, null, 2)}`);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        checks: {
          ls: true,
          cache: true,
          describe: true,
          discover: true,
          relationDryRun: true,
          create: true,
          get: true,
          find: true,
          update: true,
          delete: true,
          relationAt: true,
          relationDot: true,
          relationResolve: true,
          relationResolveOrCreate: true,
          relationRollback: true,
          execDryRun: true,
          exec: true,
        },
        widgetId,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await stopExistingDirectus(serverProcess);
}

async function ensureFixtureProject() {
  await mkdir(projectDir, { recursive: true });
  await mkdir(databaseDir, { recursive: true });
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(extensionsDir, { recursive: true });

  await writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify(
      {
        name: "skeem-directus-smoke",
        private: true,
        type: "module",
        dependencies: {
          directus: directusVersion,
          sqlite3: sqliteVersion,
        },
      },
      null,
      2,
    ),
  );

  await writeFile(
    path.join(projectDir, ".env"),
    [
      `HOST=${host}`,
      `PORT=${port}`,
      "KEY=skeem-smoke-key",
      "SECRET=skeem-smoke-secret",
      "DB_CLIENT=sqlite3",
      "DB_FILENAME=./database/data.db",
      `PUBLIC_URL=${baseUrl}`,
      `ADMIN_EMAIL=${adminEmail}`,
      `ADMIN_PASSWORD=${adminPassword}`,
      `ADMIN_TOKEN=${adminToken}`,
      "WEBSOCKETS_ENABLED=true",
    ].join("\n"),
  );

  const hasNodeModules = await exists(path.join(projectDir, "node_modules"));
  if (!hasNodeModules) {
    const install = runCommand("npm", ["install", "--no-fund", "--no-audit"], { cwd: projectDir });
    if (install.status !== 0) {
      throw new Error(`Failed to install Directus smoke fixture:\n${install.stderr || install.stdout}`);
    }
  }
}

async function resetDatabase() {
  await rm(databaseDir, { recursive: true, force: true });
  await mkdir(databaseDir, { recursive: true });
}

async function bootstrapDirectus() {
  const bootstrap = runCommand("npx", ["directus", "bootstrap"], { cwd: projectDir });
  if (bootstrap.status !== 0) {
    throw new Error(`Failed to bootstrap Directus:\n${bootstrap.stderr || bootstrap.stdout}`);
  }
}

function startDirectus() {
  const child = spawn("npx", ["directus", "start"], {
    cwd: projectDir,
    env: process.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    capturedStdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    capturedStderr += chunk.toString();
  });
  child.on("exit", (code) => {
    if (code !== 0) {
      capturedStderr += `\nDirectus exited with code ${code}.`;
    }
  });

  return child;
}

async function waitForDirectus() {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/collections`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          Accept: "application/json",
        },
      });

      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting while the server starts.
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for Directus.\nSTDOUT:\n${capturedStdout}\nSTDERR:\n${capturedStderr}`);
}

async function ensureCollection(definition) {
  const collectionName = definition.name;
  const list = await requestJson("/collections");
  const existsAlready = Array.isArray(list.data) && list.data.some((entry) => entry.collection === collectionName);
  if (existsAlready) {
    return;
  }

  const response = await fetch(`${baseUrl}/collections`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      collection: collectionName,
      meta: {
        collection: collectionName,
        icon: "inventory_2",
      },
      schema: {
        name: collectionName,
      },
      fields: definition.fields.map((field) => ({
        ...field,
        schema: {
          ...field.schema,
          table: collectionName,
        },
      })),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create collection "${collectionName}":\n${body}`);
  }
}

async function ensureRelation(definition) {
  const existing = await requestJson(`/relations/${definition.collectionMany}`).catch(() => ({ data: [] }));
  const existsAlready = Array.isArray(existing.data) && existing.data.some((entry) => (
    entry.many_collection === definition.collectionMany &&
    entry.many_field === definition.fieldMany &&
    entry.one_collection === definition.collectionOne
  ));

  if (existsAlready) {
    return;
  }

  const response = await fetch(`${baseUrl}/relations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      collection: definition.collectionMany,
      field: definition.fieldMany,
      related_collection: definition.collectionOne,
      schema: {
        table: definition.collectionMany,
        column: definition.fieldMany,
        foreign_key_table: definition.collectionOne,
        on_update: "NO ACTION",
        on_delete: "SET NULL",
      },
      meta: {
        many_collection: definition.collectionMany,
        many_field: definition.fieldMany,
        one_collection: definition.collectionOne,
        one_deselect_action: "nullify",
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create relation ${definition.collectionMany}.${definition.fieldMany} -> ${definition.collectionOne}:\n${body}`);
  }
}

async function clearSkeemCache() {
  await rm(path.join(repoRoot, ".skeem"), { recursive: true, force: true });
}

async function stopExistingDirectus(child) {
  if (child?.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Fall back to pattern kill below.
    }
  }

  runCommand("pkill", ["-f", `${projectDir}/node_modules/.bin/directus start`], { cwd: repoRoot });
  runCommand("pkill", ["-f", "npm exec directus start"], { cwd: repoRoot });
  await sleep(1_000);
}

async function requestJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${pathname}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function runCommand(command, args, options) {
  return spawnSync(command, args, {
    ...options,
    encoding: "utf8",
  });
}

async function runSkeemJson(args, options = {}) {
  const cli = runCommand(
    "node",
    [
      path.join(repoRoot, "packages", "skeem", "dist", "bin", "skeem.js"),
      ...args,
      "--json",
      "--url",
      baseUrl,
      "--token",
      adminToken,
    ],
    {
      cwd: repoRoot,
      ...(options.stdin ? { input: `${options.stdin}\n` } : {}),
    },
  );

  const expectedFailure = options.expectFailure === true;
  if (!expectedFailure && cli.status !== 0) {
    throw new Error(`skeem ${args[0]} failed:\n${cli.stderr || cli.stdout}`);
  }
  if (expectedFailure && cli.status === 0) {
    throw new Error(`skeem ${args[0]} unexpectedly succeeded:\n${cli.stdout}`);
  }

  try {
    return JSON.parse(cli.stdout);
  } catch (error) {
    throw new Error(`Failed to parse CLI JSON output for ${args.join(" ")}:\n${cli.stdout}\n${error}`);
  }
}

function expectCollection(envelope, collectionName) {
  if (!envelope.ok || !Array.isArray(envelope.data)) {
    throw new Error(`Expected collection list envelope:\n${JSON.stringify(envelope, null, 2)}`);
  }

  const collection = envelope.data.find((entry) => entry.collection === collectionName);
  if (!collection) {
    throw new Error(`Expected collection "${collectionName}" in envelope:\n${JSON.stringify(envelope, null, 2)}`);
  }

  return collection;
}

function stringField(name, options = {}) {
  return {
    field: name,
    type: "string",
    meta: {
      interface: "input",
      width: "full",
      ...(options.required ? { required: true } : {}),
    },
    schema: {
      name,
      data_type: "varchar",
      max_length: 255,
      is_nullable: options.required ? false : true,
      ...(options.unique ? { is_unique: true } : {}),
    },
  };
}

function integerField(name, options = {}) {
  return {
    field: name,
    type: "integer",
    meta: {
      interface: "input",
      width: "full",
      ...(options.required ? { required: true } : {}),
    },
    schema: {
      name,
      data_type: "integer",
      is_nullable: options.required ? false : true,
    },
  };
}

async function exists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
