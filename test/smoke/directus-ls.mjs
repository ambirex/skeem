#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
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
  await ensureCollection("widgets");
  await clearSkeemCache();

  const lsBefore = await runSkeemJson(["ls", "--counts"]);
  const widgetsBefore = expectCollection(lsBefore, "widgets");
  if (widgetsBefore.count !== 0) {
    throw new Error(`Expected widgets count to start at 0 but received ${widgetsBefore.count}.`);
  }

  const cache = await runSkeemJson(["cache", "show"]);
  if (!cache.ok || !cache.data?.exists) {
    throw new Error(`Expected schema cache to exist after ls:\n${JSON.stringify(cache, null, 2)}`);
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

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        checks: {
          ls: true,
          cache: true,
          create: true,
          get: true,
          find: true,
          update: true,
          delete: true,
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

async function ensureCollection(collectionName) {
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
      fields: [
        {
          field: "name",
          type: "string",
          meta: {
            interface: "input",
            width: "full",
          },
          schema: {
            name: "name",
            table: collectionName,
            data_type: "varchar",
            max_length: 255,
            is_nullable: true,
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create collection "${collectionName}":\n${body}`);
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
    { cwd: repoRoot },
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
