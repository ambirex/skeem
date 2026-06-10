/**
 * NocoDB conformance fixture.
 *
 * Runs the official `nocodb/nocodb` Docker image, signs up a superuser, mints an
 * API token (xc-token), creates a base, and seeds tables/relations via the meta
 * API. The base id is written onto `connection.base` during waitReady() so the
 * suite's generated `.skeemrc.yaml` can pin it.
 *
 * Requires Docker. NocoDB's base/token endpoints have shifted across versions;
 * this fixture tries the v2 endpoints first and falls back to v1.
 */
import { runCommand, waitForHttp } from "../lib.mjs";

const host = "127.0.0.1";
const port = 18059;
const baseUrl = `http://${host}:${port}`;
const containerName = "skeem-nocodb-conformance";
const adminEmail = "admin@conformance.test";
const adminPassword = "Conformance123!";
const nocodbImage = process.env["NOCODB_IMAGE"] ?? "nocodb/nocodb:latest";

let containerId = "";
// Shared connection object; base/token are filled in once the server is up.
const connection = { url: baseUrl, token: "" };

let xcAuth = "";
let baseId = "";
const tableIds = new Map();

export async function createFixture() {
  return {
    name: "nocodb",
    tier: "full",
    connection,

    async start() {
      // Remove any stale container from a previous run.
      runCommand("docker", ["rm", "-f", containerName]);
      const run = runCommand("docker", [
        "run", "-d", "--name", containerName,
        "-p", `${port}:8080`,
        nocodbImage,
      ]);
      if (run.status !== 0) {
        throw new Error(`Failed to start NocoDB container:\n${run.stderr || run.stdout}`);
      }
      containerId = run.stdout.trim();
    },

    async waitReady() {
      // NocoDB serves the dashboard once booted; /api/v1/health returns 200.
      await waitForHttp(`${baseUrl}/api/v1/health`, { timeoutMs: 120_000 }).catch(async (error) => {
        const logs = runCommand("docker", ["logs", containerName]);
        throw new Error(`${error}\nNocoDB logs:\n${logs.stdout}\n${logs.stderr}`);
      });

      xcAuth = await signupOrSignin();
      connection.token = await createApiToken(xcAuth);
      baseId = await createBase(connection.token);
      connection.base = baseId;
    },

    async stop() {
      if (containerId || containerName) {
        runCommand("docker", ["rm", "-f", containerName]);
      }
    },

    async seedCollection(name, fields) {
      if (tableIds.size === 0) {
        await refreshTableIds();
      }
      if (tableIds.has(name)) {
        return;
      }
      const created = await meta(`/api/v2/meta/bases/${baseId}/tables`, "POST", {
        title: name,
        columns: fields.map(toNocoColumn),
      });
      if (created?.id) {
        tableIds.set(name, created.id);
      } else {
        await refreshTableIds();
      }
    },

    async seedRelation({ collectionMany, collectionOne, field }) {
      await refreshTableIds();
      const manyId = tableIds.get(collectionMany);
      const oneId = tableIds.get(collectionOne);
      if (!manyId || !oneId) {
        throw new Error(`seedRelation: missing table id for ${collectionMany} or ${collectionOne}`);
      }
      await meta(`/api/v2/meta/tables/${manyId}/columns`, "POST", {
        title: field,
        uidt: "LinkToAnotherRecord",
        colOptions: { type: "bt", fk_related_model_id: oneId },
      });
    },
  };
}

async function refreshTableIds() {
  const list = await meta(`/api/v2/meta/bases/${baseId}/tables`, "GET");
  tableIds.clear();
  for (const t of list?.list ?? []) {
    tableIds.set(t.title, t.id);
  }
}

async function signupOrSignin() {
  const signup = await fetch(`${baseUrl}/api/v1/auth/user/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  if (signup.ok) {
    return (await signup.json()).token;
  }
  // Already registered — sign in instead.
  const signin = await fetch(`${baseUrl}/api/v1/auth/user/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  if (!signin.ok) {
    throw new Error(`NocoDB auth failed: ${signin.status} ${await signin.text()}`);
  }
  return (await signin.json()).token;
}

async function createApiToken(jwt) {
  for (const pathname of ["/api/v2/meta/api-tokens", "/api/v1/tokens"]) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xc-auth": jwt },
      body: JSON.stringify({ description: "skeem-conformance" }),
    });
    if (response.ok) {
      const payload = await response.json();
      if (payload?.token) return payload.token;
    }
  }
  throw new Error("Could not mint a NocoDB API token via v2 or v1 endpoints.");
}

async function createBase(token) {
  // v2 first, then the older v1 "projects" endpoint.
  const v2 = await fetch(`${baseUrl}/api/v2/meta/bases`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xc-token": token },
    body: JSON.stringify({ title: "skeem_conformance", type: "database" }),
  });
  if (v2.ok) {
    return (await v2.json()).id;
  }
  const v1 = await fetch(`${baseUrl}/api/v1/db/meta/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xc-token": token },
    body: JSON.stringify({ title: "skeem_conformance" }),
  });
  if (!v1.ok) {
    throw new Error(`Could not create a NocoDB base: ${v1.status} ${await v1.text()}`);
  }
  return (await v1.json()).id;
}

async function meta(pathname, method = "GET", body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      "xc-token": connection.token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok && method !== "GET") {
    throw new Error(`NocoDB ${method} ${pathname} failed: ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? undefined : response.json();
}

function toNocoColumn(field) {
  const uidt = field.type === "integer" ? "Number" : "SingleLineText";
  return {
    title: field.name,
    uidt,
    ...(field.required ? { rqd: true } : {}),
    ...(field.unique ? { unique: true } : {}),
  };
}
