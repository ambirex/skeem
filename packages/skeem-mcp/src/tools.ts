import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SkeemRuntime } from "skeem";

import { envelopeResult, errorResult, mergeCli, toFieldEntries, toFilter } from "./map.js";
import type { ScalarFields } from "./map.js";

/** How a tool handler obtains a connected runtime (lazy, see server.ts). */
export interface ToolContext {
  getRuntime: () => Promise<SkeemRuntime>;
  baseCli: import("skeem").CliGlobalOptions;
  readOnly: boolean;
}

// ---- shared zod fragments -------------------------------------------------

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const id = z.union([z.string(), z.number()]);
const fieldsShape = z.record(z.string(), scalar);
const filterShape = z.record(z.string(), scalar);

const RELATION_GRAMMAR =
  'Relation fields accept the related record\'s id, "?field=value" to resolve an existing record, ' +
  'or "??field=value" to resolve-or-create.';

/** Per-call write options, spread into every mutating tool's input shape. */
const writeOptsShape = {
  dry_run: z.boolean().optional().describe("Preview the operation without persisting it."),
  idempotency_key: z
    .string()
    .optional()
    .describe("Replay-protect this write: a repeat with the same key + input returns the stored result."),
  actor: z.string().optional().describe("Records who performed the operation (provenance)."),
  context: z.record(z.string(), z.unknown()).optional().describe("Structured provenance metadata (task/run ids, …)."),
};

const execOperation = z.object({
  ref: z.string().describe("Name to reference this step's result as $ref.field in later steps."),
  op: z.enum(["create", "get", "find", "findOne", "update", "delete", "upsert", "link", "unlink"]),
  collection: z.string(),
  id: id.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
  match: z.record(z.string(), z.unknown()).optional(),
  relation: z.string().optional(),
  target: z
    .object({ id: id.optional(), filter: z.record(z.string(), z.unknown()).optional(), collection: z.string().optional() })
    .optional(),
});

/**
 * Register the fixed, verb-shaped skeem tool set on an MCP server. Each tool is
 * a thin pass-through to a `SkeemRuntime` method; the envelope it returns is the
 * tool result verbatim (see map.ts). In `readOnly` mode only the read tools are
 * registered.
 */
export function registerSkeemTools(server: McpServer, ctx: ToolContext): void {
  const { getRuntime, baseCli, readOnly } = ctx;

  // ---- discovery / read ---------------------------------------------------

  server.registerTool(
    "skeem_ls",
    {
      description: "List the collections in the backend, with field counts (and row counts when requested).",
      inputSchema: { counts: z.boolean().optional().describe("Include row counts per collection.") },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return envelopeResult(await (await getRuntime()).ls({ counts: args.counts ?? false }));
      } catch (error) {
        return errorResult(error, "ls");
      }
    },
  );

  server.registerTool(
    "skeem_describe",
    {
      description: "Describe one collection: field types, required/unique flags, and relations.",
      inputSchema: { collection: z.string() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return envelopeResult(await (await getRuntime()).describe(args.collection));
      } catch (error) {
        return errorResult(error, "describe", args.collection);
      }
    },
  );

  server.registerTool(
    "skeem_discover",
    {
      description: "Export the live backend schema (collections, fields, relations) as a skeem schema document.",
      inputSchema: { collections: z.array(z.string()).optional().describe("Limit discovery to these collections.") },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return envelopeResult(await (await getRuntime()).discover({ collections: args.collections ?? [] }));
      } catch (error) {
        return errorResult(error, "discover");
      }
    },
  );

  server.registerTool(
    "skeem_get",
    {
      description: "Get a single record by id, optionally expanding relations one level.",
      inputSchema: { collection: z.string(), id, expand: z.array(z.string()).optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return envelopeResult(
          await (await getRuntime()).get(args.collection, args.id, { expand: args.expand ?? [], cli: baseCli }),
        );
      } catch (error) {
        return errorResult(error, "get", args.collection);
      }
    },
  );

  server.registerTool(
    "skeem_find",
    {
      description: "Find records by field equality. `where` matches fields exactly; supports limit/offset/sort/expand.",
      inputSchema: {
        collection: z.string(),
        where: filterShape.optional().describe("Field equality filter, e.g. { status: \"active\" }."),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
        sort: z.string().optional().describe("Field to sort by; prefix with - for descending."),
        expand: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return envelopeResult(
          await (await getRuntime()).find(args.collection, toFilter(args.where), {
            ...(args.limit !== undefined ? { limit: args.limit } : {}),
            ...(args.offset !== undefined ? { offset: args.offset } : {}),
            ...(args.sort ? { sort: args.sort } : {}),
            expand: args.expand ?? [],
            cli: baseCli,
          }),
        );
      } catch (error) {
        return errorResult(error, "find", args.collection);
      }
    },
  );

  server.registerTool(
    "skeem_claims",
    {
      description: "List active and expired claims (leases) on a record.",
      inputSchema: { collection: z.string(), id },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return envelopeResult(await (await getRuntime()).claims(`${args.collection}:${args.id}`, baseCli));
      } catch (error) {
        return errorResult(error, "claims", args.collection);
      }
    },
  );

  if (readOnly) return;

  // ---- writes -------------------------------------------------------------

  server.registerTool(
    "skeem_create",
    {
      description:
        `Create a record. ${RELATION_GRAMMAR} ` +
        "Optionally enrich from a configured source: enrich=\"<source>:<collection>:<id>\" " +
        "or \"<source>:<collection>?<field>=<value>\", with repeatable map=\"sourcePath=targetField\".",
      inputSchema: {
        collection: z.string(),
        fields: fieldsShape.describe("Field values to set. Your explicit values always win over enrichment."),
        enrich: z.string().optional(),
        map: z.array(z.string()).optional(),
        ...writeOptsShape,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const cli = mergeCli(baseCli, args);
        const enrich = args.enrich ? { enrich: { spec: args.enrich, map: args.map ?? [] } } : undefined;
        return envelopeResult(await (await getRuntime()).create(args.collection, toFieldEntries(args.fields), cli, enrich));
      } catch (error) {
        return errorResult(error, "create", args.collection);
      }
    },
  );

  server.registerTool(
    "skeem_update",
    {
      description: `Update fields on a record by id. ${RELATION_GRAMMAR}`,
      inputSchema: { collection: z.string(), id, fields: fieldsShape, ...writeOptsShape },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      try {
        const cli = mergeCli(baseCli, args);
        return envelopeResult(await (await getRuntime()).update(args.collection, args.id, toFieldEntries(args.fields), cli));
      } catch (error) {
        return errorResult(error, "update", args.collection);
      }
    },
  );

  server.registerTool(
    "skeem_upsert",
    {
      description:
        `Update the record matching \`match\`, or create it if none exists. ${RELATION_GRAMMAR} ` +
        "Supports the same enrich/map options as create.",
      inputSchema: {
        collection: z.string(),
        match: filterShape.describe("Equality filter that identifies the record to update or create."),
        fields: fieldsShape.optional(),
        enrich: z.string().optional(),
        map: z.array(z.string()).optional(),
        ...writeOptsShape,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const cli = mergeCli(baseCli, args);
        const enrich = args.enrich ? { enrich: { spec: args.enrich, map: args.map ?? [] } } : undefined;
        return envelopeResult(
          await (await getRuntime()).upsert(args.collection, toFilter(args.match), toFieldEntries(args.fields), cli, enrich),
        );
      } catch (error) {
        return errorResult(error, "upsert", args.collection);
      }
    },
  );

  server.registerTool(
    "skeem_delete",
    {
      description: "Delete a record. Soft-deletes to the trash collection by default; set hard=true to delete permanently.",
      inputSchema: {
        collection: z.string(),
        id,
        hard: z.boolean().optional().describe("Permanently delete instead of moving to trash."),
        ...writeOptsShape,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => {
      try {
        const cli = mergeCli(baseCli, args);
        return envelopeResult(await (await getRuntime()).delete(args.collection, args.id, cli, { hardDelete: args.hard ?? false }));
      } catch (error) {
        return errorResult(error, "delete", args.collection);
      }
    },
  );

  server.registerTool(
    "skeem_restore",
    {
      description: "Restore a soft-deleted record from the trash collection.",
      inputSchema: { collection: z.string(), id, ...writeOptsShape },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const cli = mergeCli(baseCli, args);
        return envelopeResult(await (await getRuntime()).restore(args.collection, args.id, cli));
      } catch (error) {
        return errorResult(error, "restore", args.collection);
      }
    },
  );

  server.registerTool(
    "skeem_link",
    {
      description:
        "Link a record to a target across a relation. Omit `relation` to let skeem infer it. " +
        "`target` is the target id, or \"collection:id\", or \"?field=value\" to resolve.",
      inputSchema: {
        source_collection: z.string(),
        source_id: id,
        relation: z.string().optional(),
        target: z.union([z.string(), z.number()]),
        ...writeOptsShape,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const cli = mergeCli(baseCli, args);
        const source = `${args.source_collection}:${args.source_id}`;
        const target = String(args.target);
        const envelope = args.relation
          ? await (await getRuntime()).link(source, args.relation, target, cli)
          : await (await getRuntime()).link(source, target, undefined, cli);
        return envelopeResult(envelope);
      } catch (error) {
        return errorResult(error, "link", args.source_collection);
      }
    },
  );

  server.registerTool(
    "skeem_unlink",
    {
      description: "Unlink a record from a target across a relation. Same target/relation grammar as skeem_link.",
      inputSchema: {
        source_collection: z.string(),
        source_id: id,
        relation: z.string().optional(),
        target: z.union([z.string(), z.number()]),
        ...writeOptsShape,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const cli = mergeCli(baseCli, args);
        const source = `${args.source_collection}:${args.source_id}`;
        const target = String(args.target);
        const envelope = args.relation
          ? await (await getRuntime()).unlink(source, args.relation, target, cli)
          : await (await getRuntime()).unlink(source, target, undefined, cli);
        return envelopeResult(envelope);
      } catch (error) {
        return errorResult(error, "unlink", args.source_collection);
      }
    },
  );

  server.registerTool(
    "skeem_exec",
    {
      description:
        "Run a multi-step plan in order, resolving $ref.field references between steps " +
        "(e.g. a later step's data can use \"$company.id\"). Idempotency keys are not supported here.",
      inputSchema: {
        operations: z.array(execOperation).describe("Ordered operations; each has a `ref`, an `op`, and a `collection`."),
        dry_run: writeOptsShape.dry_run,
        actor: writeOptsShape.actor,
        context: writeOptsShape.context,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => {
      try {
        const cli = mergeCli(baseCli, { dry_run: args.dry_run, actor: args.actor, context: args.context });
        return envelopeResult(await (await getRuntime()).exec({ operations: args.operations }, cli));
      } catch (error) {
        return errorResult(error, "exec");
      }
    },
  );

  // ---- coordination -------------------------------------------------------

  server.registerTool(
    "skeem_claim",
    {
      description:
        "Claim a lease on a record so other agents see it as taken. Lease grammar: 30s, 5m, 2h, 1d. Requires an actor.",
      inputSchema: {
        collection: z.string(),
        id,
        lease: z.string().describe("Lease duration, e.g. \"15m\"."),
        purpose: z.string().optional(),
        actor: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      try {
        const cli = mergeCli(baseCli, { actor: args.actor });
        return envelopeResult(await (await getRuntime()).claim(`${args.collection}:${args.id}`, args.lease, args.purpose, cli));
      } catch (error) {
        return errorResult(error, "claim", args.collection);
      }
    },
  );

  server.registerTool(
    "skeem_release",
    {
      description: "Release a claim on a record.",
      inputSchema: { collection: z.string(), id, actor: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const cli = mergeCli(baseCli, { actor: args.actor });
        return envelopeResult(await (await getRuntime()).release(`${args.collection}:${args.id}`, cli));
      } catch (error) {
        return errorResult(error, "release", args.collection);
      }
    },
  );

  server.registerTool(
    "skeem_annotate",
    {
      description:
        "Attach a key/value annotation (any JSON value) to a record, optionally with an expiry (30s, 5m, 2h, 1d).",
      inputSchema: {
        collection: z.string(),
        id,
        key: z.string(),
        value: z.unknown().describe("Any JSON value; stored verbatim."),
        expires: z.string().optional().describe("Optional TTL, e.g. \"2h\"."),
        actor: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      try {
        const cli = mergeCli(baseCli, { actor: args.actor });
        return envelopeResult(
          await (await getRuntime()).annotate(`${args.collection}:${args.id}`, args.key, JSON.stringify(args.value), args.expires, cli),
        );
      } catch (error) {
        return errorResult(error, "annotate", args.collection);
      }
    },
  );

  server.registerTool(
    "skeem_init",
    {
      description:
        "Provision skeem's system collections (aliases, provenance, versions, trash, claims, annotations, idempotency). " +
        "Required before claims/annotations/trash/idempotency work. Idempotent.",
      inputSchema: {
        status_only: z.boolean().optional().describe("Report which system collections exist without creating any."),
        dry_run: writeOptsShape.dry_run,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const cli = mergeCli(baseCli, { dry_run: args.dry_run });
        return envelopeResult(await (await getRuntime()).init(cli, { statusOnly: args.status_only ?? false }));
      } catch (error) {
        return errorResult(error, "init");
      }
    },
  );
}
