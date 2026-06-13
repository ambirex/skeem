// Shared Directus smoke fixture: boot a local Directus instance, provision
// collections, and run skeem against it. Used by the MCP smoke (mcp.mjs) and
// the site capture pipeline (site/capture). The fixture root is shared with
// the deep Directus smoke (directus-ls.mjs) so the ~2-3min Directus install is
// reused; only one Directus may listen on the port at a time.
//
// Lifecycle:
//   const fx = await bootDirectusFixture();
//   await fx.ensureCollection({ name: "widgets", fields: [fx.stringField("name")] });
//   const env = await fx.runSkeemJson(["ls"]);
//   await fx.stop();

import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, "../..");
export const fixtureRoot = path.join(repoRoot, "test", ".tmp", "directus-smoke");
const projectDir = path.join(fixtureRoot, "project");
const databaseDir = path.join(projectDir, "database");
const uploadsDir = path.join(projectDir, "uploads");
const extensionsDir = path.join(projectDir, "extensions");

const directusVersion = "11.17.1";
const sqliteVersion = "6.0.1";
const host = "127.0.0.1";
const port = 18055;
export const baseUrl = `http://${host}:${port}`;
const adminEmail = "admin@example.com";
const adminPassword = "testpassword";
export const adminToken = "skeem-admin-token";

let serverProcess;
let capturedStdout = "";
let capturedStderr = "";

/** Boot a fresh Directus instance (reset DB → bootstrap → start → wait ready). */
export async function bootDirectusFixture() {
  await ensureFixtureProject();
  await stopExistingDirectus();
  await resetDatabase();
  await bootstrapDirectus();
  serverProcess = startDirectus();
  await waitForDirectus();

  return {
    baseUrl,
    adminToken,
    repoRoot,
    fixtureRoot,
    projectDir,
    ensureCollection,
    ensureRelation,
    requestJson,
    createItemDirect,
    runSkeemJson,
    stringField,
    integerField,
    jsonField,
    stop: () => stopExistingDirectus(serverProcess),
  };
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
        dependencies: { directus: directusVersion, sqlite3: sqliteVersion },
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

  if (!(await exists(path.join(projectDir, "node_modules")))) {
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
        headers: { Authorization: `Bearer ${adminToken}`, Accept: "application/json" },
      });
      if (response.ok) return;
    } catch {
      // keep waiting while the server starts
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for Directus.\nSTDOUT:\n${capturedStdout}\nSTDERR:\n${capturedStderr}`);
}

async function ensureCollection(definition) {
  const collectionName = definition.name;
  const list = await requestJson("/collections");
  if (Array.isArray(list.data) && list.data.some((entry) => entry.collection === collectionName)) {
    return;
  }

  const response = await fetch(`${baseUrl}/collections`, {
    method: "POST",
    headers: postHeaders(),
    body: JSON.stringify({
      collection: collectionName,
      meta: { collection: collectionName, icon: "inventory_2" },
      schema: { name: collectionName },
      fields: definition.fields.map((field) => ({
        ...field,
        schema: { ...field.schema, table: collectionName },
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create collection "${collectionName}":\n${await response.text()}`);
  }
}

async function ensureRelation(definition) {
  const existing = await requestJson(`/relations/${definition.collectionMany}`).catch(() => ({ data: [] }));
  const existsAlready =
    Array.isArray(existing.data) &&
    existing.data.some(
      (entry) =>
        entry.many_collection === definition.collectionMany &&
        entry.many_field === definition.fieldMany &&
        entry.one_collection === definition.collectionOne,
    );
  if (existsAlready) return;

  const response = await fetch(`${baseUrl}/relations`, {
    method: "POST",
    headers: postHeaders(),
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
    throw new Error(
      `Failed to create relation ${definition.collectionMany}.${definition.fieldMany} -> ${definition.collectionOne}:\n${await response.text()}`,
    );
  }
}

async function createItemDirect(collection, payload) {
  const response = await fetch(`${baseUrl}/items/${collection}`, {
    method: "POST",
    headers: postHeaders(),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to seed "${collection}":\n${await response.text()}`);
  }
  return (await response.json()).data;
}

async function stopExistingDirectus(child) {
  if (child?.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // fall back to pattern kill below
    }
  }
  runCommand("pkill", ["-f", `${projectDir}/node_modules/.bin/directus start`], { cwd: repoRoot });
  runCommand("pkill", ["-f", "npm exec directus start"], { cwd: repoRoot });
  await sleep(1_000);
}

async function requestJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { Authorization: `Bearer ${adminToken}`, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Request failed for ${pathname}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function postHeaders() {
  return {
    Authorization: `Bearer ${adminToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

/** Run the built skeem CLI against the fixture, returning the parsed envelope. */
function runSkeemJson(args, options = {}) {
  const commandArgs = [
    path.join(repoRoot, "packages", "skeem", "dist", "bin", "skeem.js"),
    ...args,
    "--json",
    ...(options.skipConnectionFlags ? [] : ["--url", baseUrl, "--token", adminToken]),
  ];

  const cli = runCommand("node", commandArgs, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    ...(options.stdin ? { input: `${options.stdin}\n` } : {}),
  });

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
    throw new Error(`Failed to parse CLI JSON for ${args.join(" ")}:\n${cli.stdout}\n${error}`);
  }
}

function runCommand(command, args, options) {
  return spawnSync(command, args, { ...options, encoding: "utf8" });
}

function stringField(name, options = {}) {
  return {
    field: name,
    type: "string",
    meta: { interface: "input", width: "full", ...(options.required ? { required: true } : {}) },
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
    meta: { interface: "input", width: "full", ...(options.required ? { required: true } : {}) },
    schema: { name, data_type: "integer", is_nullable: options.required ? false : true },
  };
}

function jsonField(name) {
  return {
    field: name,
    type: "json",
    meta: { interface: "input-code", width: "full" },
    schema: { name, data_type: "json", is_nullable: true },
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
