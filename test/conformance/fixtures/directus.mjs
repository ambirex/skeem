import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { exists, runCommand, sleep, waitForHttp } from "../lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
// Reuse the deep-smoke project dir (node_modules already installed) but on a
// separate port + database so the two suites never clobber each other.
const projectDir = path.join(repoRoot, "test", ".tmp", "directus-smoke", "project");
const databaseDir = path.join(projectDir, "database");

const directusVersion = "11.17.1";
const sqliteVersion = "6.0.1";
const host = "127.0.0.1";
const port = 18056;
const baseUrl = `http://${host}:${port}`;
const adminEmail = "admin@example.com";
const adminPassword = "testpassword";
const adminToken = "skeem-conformance-token";

let serverProcess;
let logs = "";

export async function createFixture() {
  return {
    name: "directus",
    tier: "full",
    connection: { url: baseUrl, token: adminToken },

    async start() {
      await mkdir(projectDir, { recursive: true });
      await writeFile(path.join(projectDir, "package.json"), JSON.stringify({
        name: "directus-smoke-fixture",
        private: true,
        type: "module",
        dependencies: { directus: directusVersion, sqlite3: sqliteVersion },
      }, null, 2));
      await writeFile(path.join(projectDir, ".env"), [
        `HOST=${host}`,
        `PORT=${port}`,
        "KEY=skeem-conformance-key",
        "SECRET=skeem-conformance-secret",
        "DB_CLIENT=sqlite3",
        "DB_FILENAME=./database/conformance.db",
        `PUBLIC_URL=${baseUrl}`,
        `ADMIN_EMAIL=${adminEmail}`,
        `ADMIN_PASSWORD=${adminPassword}`,
        `ADMIN_TOKEN=${adminToken}`,
      ].join("\n"));

      if (!(await exists(path.join(projectDir, "node_modules")))) {
        const install = runCommand("npm", ["install", "--no-fund", "--no-audit"], { cwd: projectDir });
        if (install.status !== 0) {
          throw new Error(`Failed to install Directus fixture:\n${install.stderr || install.stdout}`);
        }
      }

      await rm(path.join(databaseDir, "conformance.db"), { force: true });
      await mkdir(databaseDir, { recursive: true });
      const bootstrap = runCommand("npx", ["directus", "bootstrap"], { cwd: projectDir });
      if (bootstrap.status !== 0) {
        throw new Error(`Failed to bootstrap Directus:\n${bootstrap.stderr || bootstrap.stdout}`);
      }

      serverProcess = spawn("npx", ["directus", "start"], {
        cwd: projectDir,
        env: process.env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      serverProcess.stdout.on("data", (c) => { logs += c.toString(); });
      serverProcess.stderr.on("data", (c) => { logs += c.toString(); });
    },

    async waitReady() {
      await waitForHttp(`${baseUrl}/collections`, {
        headers: { Authorization: `Bearer ${adminToken}`, Accept: "application/json" },
      }).catch((error) => {
        throw new Error(`${error}\nDirectus logs:\n${logs}`);
      });
    },

    async stop() {
      if (serverProcess?.pid) {
        try {
          process.kill(-serverProcess.pid, "SIGTERM");
        } catch {
          try { serverProcess.kill("SIGTERM"); } catch { /* already gone */ }
        }
        await sleep(500);
      }
    },

    async seedCollection(name, fields) {
      const list = await api("/collections");
      if (Array.isArray(list.data) && list.data.some((c) => c.collection === name)) {
        return;
      }
      await api("/collections", "POST", {
        collection: name,
        meta: { collection: name },
        schema: { name },
        fields: fields.map((f) => toDirectusField(name, f)),
      });
    },

    async seedRelation({ collectionMany, collectionOne, field }) {
      // m2o: an integer FK column + a relation row.
      await api(`/fields/${collectionMany}`, "POST", toDirectusField(collectionMany, { name: field, type: "integer" }))
        .catch(() => {});
      await api("/relations", "POST", {
        collection: collectionMany,
        field,
        related_collection: collectionOne,
        schema: {
          table: collectionMany,
          column: field,
          foreign_key_table: collectionOne,
          on_update: "NO ACTION",
          on_delete: "SET NULL",
        },
        meta: {
          many_collection: collectionMany,
          many_field: field,
          one_collection: collectionOne,
          one_deselect_action: "nullify",
        },
      });
    },
  };
}

async function api(pathname, method = "GET", body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok && method !== "GET") {
    throw new Error(`Directus ${method} ${pathname} failed: ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? undefined : response.json();
}

function toDirectusField(collection, field) {
  const isInteger = field.type === "integer";
  return {
    field: field.name,
    type: isInteger ? "integer" : "string",
    meta: { interface: "input", width: "full", ...(field.required ? { required: true } : {}) },
    schema: {
      name: field.name,
      table: collection,
      data_type: isInteger ? "integer" : "varchar",
      ...(isInteger ? {} : { max_length: 255 }),
      is_nullable: field.required ? false : true,
      ...(field.unique ? { is_unique: true } : {}),
    },
  };
}
