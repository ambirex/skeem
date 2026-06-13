import { describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { NotFoundError } from "skeem";
import type { CliGlobalOptions, SkeemRuntime, SuccessEnvelope } from "skeem";

import { createLazyRuntimeGetter, createSkeemMcpServer } from "./server.js";

const baseCli: CliGlobalOptions = {
  json: true,
  noCache: false,
  refresh: false,
  dryRun: false,
  yes: true,
  verbose: false,
  noRollback: false,
  allowDestructive: false,
};

const ALL_TOOLS = [
  "skeem_ls", "skeem_describe", "skeem_discover", "skeem_get", "skeem_find", "skeem_claims",
  "skeem_create", "skeem_update", "skeem_upsert", "skeem_delete", "skeem_restore",
  "skeem_link", "skeem_unlink", "skeem_exec", "skeem_claim", "skeem_release", "skeem_annotate", "skeem_init",
];
const READ_TOOLS = ["skeem_ls", "skeem_describe", "skeem_discover", "skeem_get", "skeem_find", "skeem_claims"];

const lsEnvelope: SuccessEnvelope = { ok: true, operation: "ls", data: [{ collection: "widgets", fields: 3 }], count: 1 };

function mockRuntime(overrides: Partial<Record<string, unknown>> = {}): SkeemRuntime {
  return {
    ls: async () => lsEnvelope,
    get: async () => {
      throw new NotFoundError("widgets", "999");
    },
    ...overrides,
  } as unknown as SkeemRuntime;
}

async function connectClient(server: ReturnType<typeof createSkeemMcpServer>): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("createLazyRuntimeGetter", () => {
  test("caches success and retries after a failure", async () => {
    let calls = 0;
    let fail = true;
    const get = createLazyRuntimeGetter(async () => {
      calls += 1;
      if (fail) throw new Error("boom");
      return {} as SkeemRuntime;
    });

    await expect(get()).rejects.toThrow("boom");
    expect(calls).toBe(1);

    fail = false;
    await expect(get()).resolves.toBeDefined();
    expect(calls).toBe(2); // reset after failure → factory ran again

    await get();
    expect(calls).toBe(2); // success is now cached
  });
});

describe("skeem MCP server", () => {
  test("registers the full fixed tool set", async () => {
    const client = await connectClient(createSkeemMcpServer({ baseCli, cwd: ".", getRuntime: async () => mockRuntime() }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...ALL_TOOLS].sort());
  });

  test("read-only mode registers only the read tools", async () => {
    const client = await connectClient(
      createSkeemMcpServer({ baseCli, cwd: ".", readOnly: true, getRuntime: async () => mockRuntime() }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOLS].sort());
  });

  test("a successful call returns the envelope as structuredContent", async () => {
    const client = await connectClient(createSkeemMcpServer({ baseCli, cwd: ".", getRuntime: async () => mockRuntime() }));
    const result = await client.callTool({ name: "skeem_ls", arguments: {} });
    expect(result.structuredContent).toEqual(lsEnvelope);
    expect(result.isError).toBeFalsy();
  });

  test("a runtime error becomes an ok:false result, not a protocol error", async () => {
    const client = await connectClient(createSkeemMcpServer({ baseCli, cwd: ".", getRuntime: async () => mockRuntime() }));
    const result = await client.callTool({ name: "skeem_get", arguments: { collection: "widgets", id: "999" } });
    const envelope = result.structuredContent as { ok: boolean; error: { code: string } };
    expect(result.isError).toBeFalsy();
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("NOT_FOUND");
  });

  test("tool annotations mark reads and destructive deletes", async () => {
    const client = await connectClient(createSkeemMcpServer({ baseCli, cwd: ".", getRuntime: async () => mockRuntime() }));
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get("skeem_ls")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("skeem_delete")?.annotations?.destructiveHint).toBe(true);
  });
});
