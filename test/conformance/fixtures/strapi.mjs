/**
 * Strapi conformance fixture (tier: "data").
 *
 * Unlike PocketBase and NocoDB, Strapi content types are defined in code and
 * cannot be provisioned at runtime, so this fixture does not spin up a server.
 * It connects to a Strapi v5 instance you provide via env vars and expects the
 * baseline content types to already exist:
 *
 *   STRAPI_URL              e.g. http://localhost:1337
 *   STRAPI_TOKEN            a full-access API token (Bearer)
 *   STRAPI_ADMIN_EMAIL      admin login (for content-type introspection)
 *   STRAPI_ADMIN_PASSWORD
 *
 * Required content types (Draft & Publish OFF so created entries are live):
 *   - company  (plural "companies"): name (string, required, unique), industry (string)
 *   - person   (plural "people"):    name (string, required), company (relation manyToOne -> company)
 *   - widget   (plural "widgets"):   name (string)
 *
 * The API token needs find/findOne/create/update/delete on all three.
 */
import { waitForHttp } from "../lib.mjs";

const url = process.env["STRAPI_URL"];
const token = process.env["STRAPI_TOKEN"];
const email = process.env["STRAPI_ADMIN_EMAIL"];
const password = process.env["STRAPI_ADMIN_PASSWORD"];

const SETUP_MESSAGE = [
  "Strapi conformance needs a running Strapi v5 instance with the baseline content types.",
  "Set STRAPI_URL, STRAPI_TOKEN, STRAPI_ADMIN_EMAIL, and STRAPI_ADMIN_PASSWORD,",
  "and create the company/person/widget content types (see fixtures/strapi.mjs header).",
].join("\n");

export async function createFixture() {
  if (!url || !token || !email || !password) {
    throw new Error(SETUP_MESSAGE);
  }

  return {
    name: "strapi",
    tier: "data",
    connection: { url, token, email, password },

    async start() {
      // Nothing to provision — the instance is user-managed.
    },

    async waitReady() {
      await waitForHttp(`${url}/api/companies?pagination[pageSize]=1`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      }).catch((error) => {
        throw new Error(`${error}\nIs the Strapi instance reachable and the "companies" type published?`);
      });
    },

    async stop() {
      // Nothing to tear down.
    },

    async seedCollection(name) {
      // Content types are code-defined; just verify the expected type resolves.
      const response = await fetch(`${url}/api/${name}?pagination[pageSize]=1`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (response.status === 404) {
        throw new Error(`Strapi content type "${name}" not found. ${SETUP_MESSAGE}`);
      }
    },

    async seedRelation() {
      // The people -> companies relation is part of the code-defined schema.
    },
  };
}
