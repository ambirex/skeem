/**
 * PocketBase conformance fixture.
 *
 * Downloads the PocketBase binary on first run and caches it in test/.tmp/pocketbase-bin/.
 * Set POCKETBASE_VERSION env var to override the default version.
 *
 * Requires: curl + unzip (standard on macOS and GitHub Actions ubuntu-latest).
 */
import { createWriteStream } from "node:fs";
import { chmod, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

import { exists, runCommand, sleep, waitForHttp } from "../lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const PB_VERSION = process.env["POCKETBASE_VERSION"] ?? "0.25.0";
const binDir = path.join(repoRoot, "test", ".tmp", "pocketbase-bin");
const binPath = path.join(binDir, "pocketbase");
const dataDir = path.join(repoRoot, "test", ".tmp", "pocketbase-data");

const host = "127.0.0.1";
const port = 18058;
const baseUrl = `http://${host}:${port}`;
const adminEmail = "admin@conformance.test";
const adminPassword = "conformance-password-123";

let serverProcess;
let logs = "";

function pbPlatform() {
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  return { os, arch };
}

async function downloadBinary() {
  const { os, arch } = pbPlatform();
  const zipName = `pocketbase_${PB_VERSION}_${os}_${arch}.zip`;
  const zipPath = path.join(binDir, zipName);
  const downloadUrl = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${zipName}`;

  await mkdir(binDir, { recursive: true });

  console.error(`[pocketbase fixture] Downloading PocketBase v${PB_VERSION} (${os}/${arch})...`);
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download PocketBase binary from ${downloadUrl}: ${response.status} ${response.statusText}`
    );
  }
  await pipeline(response.body, createWriteStream(zipPath));

  const unzip = runCommand("unzip", ["-o", "-q", zipName, "pocketbase"], { cwd: binDir });
  if (unzip.status !== 0) {
    throw new Error(`Failed to unzip PocketBase binary:\n${unzip.stderr || unzip.stdout}`);
  }
  await chmod(binPath, 0o755);
  console.error(`[pocketbase fixture] Downloaded PocketBase to ${binPath}`);
}

export async function createFixture() {
  return {
    name: "pocketbase",
    tier: "full",
    connection: { url: baseUrl, email: adminEmail, password: adminPassword },

    async start() {
      if (!(await exists(binPath))) {
        await downloadBinary();
      }

      await rm(dataDir, { recursive: true, force: true });
      await mkdir(dataDir, { recursive: true });

      // Create the superuser before starting the server.
      const upsert = runCommand(binPath, [
        "superuser", "upsert", adminEmail, adminPassword,
        "--dir", dataDir,
      ]);
      if (upsert.status !== 0) {
        throw new Error(`Failed to create PocketBase superuser:\n${upsert.stderr || upsert.stdout}`);
      }

      serverProcess = spawn(binPath, ["serve", "--dir", dataDir, "--http", `${host}:${port}`], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      serverProcess.stdout.on("data", (c) => { logs += c.toString(); });
      serverProcess.stderr.on("data", (c) => { logs += c.toString(); });
    },

    async waitReady() {
      await waitForHttp(`${baseUrl}/api/health`).catch((error) => {
        throw new Error(`${error}\nPocketBase logs:\n${logs}`);
      });
    },

    async stop() {
      if (serverProcess?.pid) {
        try {
          process.kill(-serverProcess.pid, "SIGTERM");
        } catch {
          try { serverProcess.kill("SIGTERM"); } catch { /* already gone */ }
        }
        await sleep(300);
      }
    },

    async seedCollection(name, fields) {
      // Skip if already exists.
      const list = await api("/api/collections?perPage=500");
      if (list.items?.some((c) => c.name === name)) return;

      const uniqueFields = fields.filter((f) => f.unique);
      await api("/api/collections", "POST", {
        name,
        type: "base",
        fields: fields.map(toSeedField),
        indexes: uniqueFields.map((f) =>
          `CREATE UNIQUE INDEX \`idx_${name}_${f.name}\` ON \`${name}\` (\`${f.name}\`)`
        ),
      });
    },

    async seedRelation({ collectionMany, collectionOne, field }) {
      const list = await api("/api/collections?perPage=500");
      const oneCol = list.items?.find((c) => c.name === collectionOne);
      const manyCol = list.items?.find((c) => c.name === collectionMany);
      if (!oneCol || !manyCol) {
        throw new Error(`seedRelation: could not find ${collectionOne} or ${collectionMany}`);
      }
      // Check if field already exists.
      if (manyCol.fields?.some((f) => f.name === field)) return;

      await api(`/api/collections/${collectionMany}`, "PATCH", {
        fields: [
          ...manyCol.fields,
          {
            name: field,
            type: "relation",
            required: false,
            collectionId: oneCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
        ],
        indexes: manyCol.indexes ?? [],
      });
    },
  };
}

async function api(pathname, method = "GET", body) {
  // Authenticate on first request to get a fresh token.
  let token = await getToken();
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok && method !== "GET") {
    throw new Error(`PocketBase ${method} ${pathname} failed: ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? undefined : response.json();
}

let cachedToken;

async function getToken() {
  if (cachedToken) return cachedToken;
  const response = await fetch(`${baseUrl}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
  });
  if (!response.ok) {
    throw new Error(`PocketBase auth failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  cachedToken = data.token;
  return cachedToken;
}

function toSeedField(field) {
  if (field.type === "integer") {
    return { name: field.name, type: "number", required: !!field.required };
  }
  return { name: field.name, type: "text", required: !!field.required };
}
