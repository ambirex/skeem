#!/usr/bin/env node

// End-to-end smoke for @skeems/mcp: boot a real Directus fixture, launch the
// built MCP server over stdio with the official SDK client, and exercise
// initialize → tools/list → a read, a write, a relation-grammar compound
// create, and an error path. Run with: npm run smoke:mcp
//
// The server is pointed at an isolated workspace (its own .skeemrc.yaml) so it
// connects to the fixture and keeps its schema cache local to the workspace.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { bootDirectusFixture } from "./directus-fixture.mjs";

const EXPECTED_TOOLS = [
  "skeem_ls", "skeem_describe", "skeem_discover", "skeem_get", "skeem_find", "skeem_claims",
  "skeem_create", "skeem_update", "skeem_upsert", "skeem_delete", "skeem_restore",
  "skeem_link", "skeem_unlink", "skeem_exec", "skeem_claim", "skeem_release", "skeem_annotate", "skeem_init",
];

let passed = 0;
function check(label, condition, detail) {
  if (!condition) {
    throw new Error(`FAILED: ${label}${detail ? `\n${detail}` : ""}`);
  }
  passed += 1;
  console.log(`  ok  ${label}`);
}

/** Parse the envelope a tool returns (canonical JSON text content). */
function envelopeOf(result) {
  if (result.structuredContent) return result.structuredContent;
  const block = (result.content ?? []).find((c) => c.type === "text");
  return block ? JSON.parse(block.text) : undefined;
}

async function callEnvelope(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  return { result, envelope: envelopeOf(result) };
}

async function main() {
  console.log("Booting Directus fixture…");
  const fx = await bootDirectusFixture();

  try {
    await fx.ensureCollection({ name: "widgets", fields: [fx.stringField("name")] });
    await fx.ensureCollection({
      name: "companies",
      fields: [fx.stringField("name", { required: true, unique: true }), fx.stringField("industry")],
    });
    await fx.ensureCollection({
      name: "people",
      fields: [fx.stringField("name", { required: true }), fx.integerField("company_id")],
    });
    await fx.ensureRelation({ collectionMany: "people", fieldMany: "company_id", collectionOne: "companies" });

    // Isolated workspace so the server's config + schema cache stay local.
    const workspace = path.join(fx.fixtureRoot, "mcp-workspace");
    await mkdir(workspace, { recursive: true });
    await writeFile(
      path.join(workspace, ".skeemrc.yaml"),
      [
        "adapter: directus",
        "cache:",
        "  ttl_ms: 600000",
        "connection:",
        `  url: "${fx.baseUrl}"`,
        `  token: "${fx.adminToken}"`,
      ].join("\n"),
    );

    const serverEntry = path.join(fx.repoRoot, "packages", "skeem-mcp", "dist", "bin", "skeem-mcp.js");
    const transport = new StdioClientTransport({
      command: "node",
      args: [serverEntry, "--cwd", workspace, "--actor", "mcp-smoke"],
      stderr: "inherit",
    });
    const client = new Client({ name: "skeem-mcp-smoke", version: "0" });

    console.log("Connecting MCP client over stdio…");
    await client.connect(transport);

    try {
      const serverVersion = client.getServerVersion();
      check("initialize reports server name 'skeem'", serverVersion?.name === "skeem", JSON.stringify(serverVersion));

      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      check(
        `tools/list returns the fixed ${EXPECTED_TOOLS.length}-tool set`,
        JSON.stringify(names) === JSON.stringify([...EXPECTED_TOOLS].sort()),
        names.join(", "),
      );
      check(
        "skeem_delete is annotated destructive",
        tools.find((t) => t.name === "skeem_delete")?.annotations?.destructiveHint === true,
      );

      const ls = await callEnvelope(client, "skeem_ls", {});
      check(
        "skeem_ls lists the widgets collection",
        ls.envelope?.ok === true && Array.isArray(ls.envelope.data) && ls.envelope.data.some((c) => c.collection === "widgets"),
        JSON.stringify(ls.envelope),
      );

      const created = await callEnvelope(client, "skeem_create", { collection: "widgets", fields: { name: "mcp-widget" } });
      check(
        "skeem_create returns ok with a new id",
        created.envelope?.ok === true && created.envelope.data?.id !== undefined && created.envelope.data?.name === "mcp-widget",
        JSON.stringify(created.envelope),
      );
      const widgetId = created.envelope.data.id;

      const fetched = await callEnvelope(client, "skeem_get", { collection: "widgets", id: widgetId });
      check(
        "skeem_get round-trips the created record",
        fetched.envelope?.ok === true && String(fetched.envelope.data?.id) === String(widgetId),
        JSON.stringify(fetched.envelope),
      );

      // Relation grammar: resolve-or-create the company while creating a person.
      const compound = await callEnvelope(client, "skeem_create", {
        collection: "people",
        fields: { name: "Mia", company_id: "??name=Acme" },
      });
      check(
        "skeem_create resolves ??name=Acme into a compound create",
        compound.envelope?.ok === true &&
          (compound.envelope.operation === "compound_create" || Array.isArray(compound.envelope.plan) || compound.envelope.data?.company_id !== undefined),
        JSON.stringify(compound.envelope),
      );

      // Error passthrough: a failed read comes back as a NORMAL result carrying
      // an ok:false envelope with a typed error.code — NOT a protocol isError —
      // so the agent can branch on the code. (Directus masks a missing id as a
      // 403 → AUTH; reference adapters yield NOT_FOUND. The code is backend-
      // specific; the contract is not. server.test.ts pins NOT_FOUND via a mock.)
      const missing = await callEnvelope(client, "skeem_get", { collection: "widgets", id: 999999 });
      check(
        "a failed read is a normal result with ok:false and a typed error.code",
        missing.result.isError !== true &&
          missing.envelope?.ok === false &&
          typeof missing.envelope.error?.code === "string" &&
          missing.envelope.error.code.length > 0,
        JSON.stringify({ isError: missing.result.isError, envelope: missing.envelope }),
      );
    } finally {
      await client.close();
    }

    console.log(`\nMCP smoke passed (${passed} checks).`);
  } finally {
    await fx.stop();
  }
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
