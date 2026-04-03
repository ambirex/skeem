import { createDirectusAdapter } from "@skeem/directus";

import { SchemaCache } from "../cache/schema-cache.js";
import {
  AmbiguousError,
  AuthError,
  DuplicateError,
  NotFoundError,
  UsageError,
  ValidationError,
} from "../errors/index.js";
import { loadConfig } from "../config/load-config.js";
import { requireCollection, resolveCollectionName, resolveExpandPaths, resolveRelation, filterCollections } from "./schema.js";
import { buildInputNode, parseFilterAssignment, resolveRefs, topoSortOperations } from "./values.js";
import { toSuccessEnvelope } from "../output/formatter.js";
import type {
  CliGlobalOptions,
  Collection,
  EntityRecord,
  ExecPlanInput,
  Filter,
  InputNode,
  OperationLogEntry,
  PrimaryKey,
  Relation,
  ResolvedConfig,
  Schema,
  SkemAdapter,
  SuccessEnvelope,
} from "../types/index.js";

interface CreatedRecordRef {
  collection: string;
  id: PrimaryKey;
}

interface MutationResult {
  record: EntityRecord;
  plan: OperationLogEntry[];
  created: CreatedRecordRef[];
}

export class SkeemRuntime {
  private constructor(
    public readonly config: ResolvedConfig,
    private readonly adapter: SkemAdapter,
    private readonly cache: SchemaCache,
  ) {}

  static async create(cwd: string, cli: CliGlobalOptions): Promise<SkeemRuntime> {
    const config = await loadConfig(cwd, cli);
    const rawAdapter = createDirectusAdapter();
    await rawAdapter.connect(config.connection);
    const adapter: SkemAdapter = {
      ...rawAdapter,
      async findOne(collection, filter) {
        const rows = await rawAdapter.find(collection, filter, { limit: 2 });
        if (rows.length === 0) {
          throw new NotFoundError(collection, undefined, filter);
        }
        if (rows.length > 1) {
          throw new AmbiguousError(collection, filter, rows.length);
        }
        return rows[0]!;
      },
    };
    const cache = new SchemaCache(config.rootDir, config.cache.ttlMs);
    return new SkeemRuntime(config, adapter, cache);
  }

  async ls(options: { counts: boolean }): Promise<SuccessEnvelope> {
    const schema = await this.loadLiveSchema();
    const collections = filterCollections(schema, this.config);
    const data = await Promise.all(
      collections.map(async (collection) => ({
        collection: collection.name,
        fields: collection.fields.size,
        ...(options.counts && this.adapter.count ? { count: await this.adapter.count(collection.name) } : {}),
      })),
    );

    return toSuccessEnvelope({
      operation: "ls",
      data,
      count: data.length,
    });
  }

  async get(
    collectionInput: string,
    id: PrimaryKey,
    options: { expand: string[]; cli: CliGlobalOptions },
  ): Promise<SuccessEnvelope> {
    const schema = await this.loadSchemaForData(options.cli);
    const collection = this.resolveCollection(schema, collectionInput);
    const expand = resolveExpandPaths(schema, collection.name, options.expand);

    try {
      const record = await this.adapter.get(collection.name, id, expand.length > 0 ? { expand } : undefined);
      return toSuccessEnvelope({
        operation: "get",
        collection: collection.name,
        data: record,
      });
    } catch (error) {
      throw this.normalizeError(error, collection.name);
    }
  }

  async find(
    collectionInput: string,
    filter: Filter,
    options: { limit?: number; offset?: number; sort?: string; expand: string[]; cli: CliGlobalOptions },
  ): Promise<SuccessEnvelope> {
    const schema = await this.loadSchemaForData(options.cli);
    const collection = this.resolveCollection(schema, collectionInput);
    const expand = resolveExpandPaths(schema, collection.name, options.expand);

    try {
      const records = await this.adapter.find(collection.name, filter, {
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
        ...(options.sort ? { sort: options.sort } : {}),
        ...(expand.length > 0 ? { expand } : {}),
      });
      return toSuccessEnvelope({
        operation: "find",
        collection: collection.name,
        data: records,
        count: records.length,
      });
    } catch (error) {
      throw this.normalizeError(error, collection.name);
    }
  }

  async create(collectionInput: string, fieldEntries: Array<[string, string]>, cli: CliGlobalOptions): Promise<SuccessEnvelope> {
    const schema = await this.loadSchemaForData(cli);
    const collection = this.resolveCollection(schema, collectionInput);
    const node = buildInputNode(fieldEntries, collection.name);

    if (cli.dryRun) {
      return toSuccessEnvelope({
        operation: "dry_run",
        collection: collection.name,
        plan: this.previewCreate(schema, collection, node, ["root"]),
      });
    }

    try {
      const result = await this.createNode(schema, collection, node, ["root"]);
      return toSuccessEnvelope({
        operation: result.plan.length > 1 ? "compound_create" : "create",
        collection: collection.name,
        data: result.record,
        plan: result.plan,
      });
    } catch (error) {
      if (!cli.noRollback && error instanceof MutationFailureError) {
        await this.rollback(error.created);
      }
      throw this.unwrapMutationError(error, collection.name);
    }
  }

  async update(
    collectionInput: string,
    id: PrimaryKey,
    fieldEntries: Array<[string, string]>,
    cli: CliGlobalOptions,
  ): Promise<SuccessEnvelope> {
    const schema = await this.loadSchemaForData(cli);
    const collection = this.resolveCollection(schema, collectionInput);
    const node = buildInputNode(fieldEntries, collection.name);

    if (cli.dryRun) {
      const preview = this.previewCreate(schema, collection, node, ["root"]).concat({
        ref: "root",
        operation: "update",
        collection: collection.name,
        data: { id, fields: node.fields },
      });
      return toSuccessEnvelope({
        operation: "dry_run",
        collection: collection.name,
        plan: preview,
      });
    }

    const created: CreatedRecordRef[] = [];
    const data: Record<string, unknown> = { ...node.fields };
    const plan: OperationLogEntry[] = [];

    try {
      for (const [segment, childNode] of Object.entries(node.children)) {
        const relation = resolveRelation(collection, segment);
        const childResult = await this.resolveRelationInput(schema, relation, childNode, ["root", segment]);
        data[relation.field] = childResult.id;
        created.push(...childResult.created);
        plan.push(...childResult.plan);
      }

      const record = await this.adapter.update(collection.name, id, data);
      plan.push({
        ref: "root",
        operation: "update",
        collection: collection.name,
        data: record,
      });

      return toSuccessEnvelope({
        operation: "update",
        collection: collection.name,
        data: record,
        plan,
      });
    } catch (error) {
      if (!cli.noRollback) {
        await this.rollback(created);
      }
      throw this.normalizeError(error, collection.name);
    }
  }

  async delete(collectionInput: string, id: PrimaryKey, cli: CliGlobalOptions): Promise<SuccessEnvelope> {
    const schema = await this.loadSchemaForData(cli);
    const collection = this.resolveCollection(schema, collectionInput);

    if (cli.dryRun) {
      return toSuccessEnvelope({
        operation: "dry_run",
        collection: collection.name,
        plan: [
          {
            ref: "root",
            operation: "delete",
            collection: collection.name,
            data: { id },
          },
        ],
      });
    }

    try {
      await this.adapter.delete(collection.name, id);
      return toSuccessEnvelope({
        operation: "delete",
        collection: collection.name,
        data: { id },
      });
    } catch (error) {
      throw this.normalizeError(error, collection.name);
    }
  }

  async exec(planInput: ExecPlanInput, cli: CliGlobalOptions): Promise<SuccessEnvelope> {
    const schema = await this.loadSchemaForData(cli);
    const ordered = topoSortOperations(planInput.operations);
    const context: Record<string, Record<string, unknown>> = {};
    const plan: OperationLogEntry[] = [];
    const created: CreatedRecordRef[] = [];

    if (cli.dryRun) {
      return toSuccessEnvelope({
        operation: "dry_run",
        plan: ordered.map((operation) => ({
          ref: operation.ref,
          operation: operation.op,
          collection: this.resolveCollection(schema, operation.collection).name,
          data: {
            ...(operation.id !== undefined ? { id: operation.id } : {}),
            ...(operation.filter ? { filter: operation.filter } : {}),
            ...(operation.data ? { data: operation.data } : {}),
          },
        })),
      });
    }

    try {
      for (const operation of ordered) {
        const collection = this.resolveCollection(schema, operation.collection).name;
        const resolved = resolveRefs(operation, context);
        let result: Record<string, unknown> | Record<string, unknown>[] | null = null;

        switch (resolved.op) {
          case "create": {
            result = await this.adapter.create(collection, resolved.data ?? {});
            created.push({ collection, id: this.recordPrimaryKey(requireCollection(schema, collection), result) });
            break;
          }
          case "get": {
            if (resolved.id === undefined) {
              throw new UsageError(`Exec operation "${resolved.ref}" is missing an id.`);
            }
            result = await this.adapter.get(collection, resolved.id);
            break;
          }
          case "find": {
            result = await this.adapter.find(collection, (resolved.filter ?? {}) as Filter);
            break;
          }
          case "findOne": {
            result = await this.adapter.findOne(collection, (resolved.filter ?? {}) as Filter);
            break;
          }
          case "update": {
            if (resolved.id === undefined) {
              throw new UsageError(`Exec operation "${resolved.ref}" is missing an id.`);
            }
            result = await this.adapter.update(collection, resolved.id, resolved.data ?? {});
            break;
          }
          case "delete": {
            if (resolved.id === undefined) {
              throw new UsageError(`Exec operation "${resolved.ref}" is missing an id.`);
            }
            await this.adapter.delete(collection, resolved.id);
            result = { id: resolved.id };
            break;
          }
        }

        context[operation.ref] = Array.isArray(result) ? { items: result } : (result ?? {});
        plan.push({
          ref: operation.ref,
          operation: operation.op,
          collection,
          data: result,
        });
      }
    } catch (error) {
      if (!cli.noRollback) {
        await this.rollback(created);
      }
      throw this.normalizeError(error);
    }

    return toSuccessEnvelope({
      operation: "exec",
      plan,
      count: plan.length,
    });
  }

  async cacheShow(): Promise<SuccessEnvelope> {
    return toSuccessEnvelope({
      operation: "cache_show",
      data: await this.cache.status(),
    });
  }

  async cacheClear(): Promise<SuccessEnvelope> {
    await this.cache.clear();
    return toSuccessEnvelope({
      operation: "cache_clear",
      data: { cleared: true },
    });
  }

  private async createNode(schema: Schema, collection: Collection, node: InputNode, trail: string[]): Promise<MutationResult> {
    const data: Record<string, unknown> = { ...node.fields };
    const plan: OperationLogEntry[] = [];
    const created: CreatedRecordRef[] = [];

    try {
      for (const [segment, childNode] of Object.entries(node.children)) {
        const relation = resolveRelation(collection, segment);
        const childResult = await this.resolveRelationInput(schema, relation, childNode, [...trail, segment]);
        data[relation.field] = childResult.id;
        plan.push(...childResult.plan);
        created.push(...childResult.created);
      }

      const record = await this.adapter.create(collection.name, data);
      const id = this.recordPrimaryKey(collection, record);
      plan.push({
        ref: makeRef(trail),
        operation: "create",
        collection: collection.name,
        data: record,
      });
      created.push({ collection: collection.name, id });
      return { record, plan, created };
    } catch (error) {
      throw new MutationFailureError(this.normalizeError(error, collection.name), created);
    }
  }

  private async resolveRelationInput(
    schema: Schema,
    relation: Relation,
    node: InputNode,
    trail: string[],
  ): Promise<{ id: PrimaryKey; plan: OperationLogEntry[]; created: CreatedRecordRef[] }> {
    const targetCollection = requireCollection(schema, relation.relatedCollection);

    if (node.selector?.kind === "id") {
      if (Object.keys(node.fields).length > 0 || Object.keys(node.children).length > 0) {
        throw new UsageError(`Cannot combine nested fields with direct id reference for "${trail.join(".")}".`);
      }

      return {
        id: node.selector.id,
        plan: [
          {
            ref: makeRef(trail),
            operation: "reference",
            collection: targetCollection.name,
            data: { id: node.selector.id },
          },
        ],
        created: [],
      };
    }

    if (node.selector?.kind === "resolve") {
      if (Object.keys(node.fields).length > 0 || Object.keys(node.children).length > 0) {
        throw new UsageError(`Only "??" supports fallback fields for "${trail.join(".")}".`);
      }

      const record = await this.adapter.findOne(targetCollection.name, node.selector.filter);
      return {
        id: this.recordPrimaryKey(targetCollection, record),
        plan: [
          {
            ref: makeRef(trail),
            operation: "resolve",
            collection: targetCollection.name,
            action: "resolved",
            data: record,
          },
        ],
        created: [],
      };
    }

    if (node.selector?.kind === "resolveOrCreate") {
      try {
        const record = await this.adapter.findOne(targetCollection.name, node.selector.filter);
        return {
          id: this.recordPrimaryKey(targetCollection, record),
          plan: [
            {
              ref: makeRef(trail),
              operation: "resolveOrCreate",
              collection: targetCollection.name,
              action: "resolved",
              data: record,
            },
          ],
          created: [],
        };
      } catch (error) {
        if (!(error instanceof NotFoundError)) {
          throw this.normalizeError(error, targetCollection.name);
        }

        const createNode: InputNode = {
          fields: {
            ...node.selector.filter,
            ...node.fields,
          },
          children: node.children,
        };
        const created = await this.createNode(schema, targetCollection, createNode, trail);
        return {
          id: this.recordPrimaryKey(targetCollection, created.record),
          plan: created.plan,
          created: created.created,
        };
      }
    }

    const created = await this.createNode(schema, targetCollection, node, trail);
    return {
      id: this.recordPrimaryKey(targetCollection, created.record),
      plan: created.plan,
      created: created.created,
    };
  }

  private previewCreate(schema: Schema, collection: Collection, node: InputNode, trail: string[]): OperationLogEntry[] {
    const plan: OperationLogEntry[] = [];

    for (const [segment, childNode] of Object.entries(node.children)) {
      const relation = resolveRelation(collection, segment);
      const targetCollection = requireCollection(schema, relation.relatedCollection);
      const ref = makeRef([...trail, segment]);

      if (childNode.selector?.kind === "id") {
        plan.push({
          ref,
          operation: "reference",
          collection: targetCollection.name,
          data: { id: childNode.selector.id },
        });
        continue;
      }

      if (childNode.selector?.kind === "resolve") {
        plan.push({
          ref,
          operation: "resolve",
          collection: targetCollection.name,
          data: childNode.selector.filter,
        });
        continue;
      }

      if (childNode.selector?.kind === "resolveOrCreate") {
        plan.push({
          ref,
          operation: "resolveOrCreate",
          collection: targetCollection.name,
          data: {
            filter: childNode.selector.filter,
            create: {
              ...childNode.selector.filter,
              ...childNode.fields,
            },
          },
        });
        continue;
      }

      plan.push(...this.previewCreate(schema, targetCollection, childNode, [...trail, segment]));
    }

    plan.push({
      ref: makeRef(trail),
      operation: "create",
      collection: collection.name,
      data: node.fields,
    });
    return plan;
  }

  private async loadLiveSchema(): Promise<Schema> {
    const schema = await this.adapter.introspect();
    await this.cache.write(schema, {
      savedAt: new Date().toISOString(),
      adapter: this.adapter.name,
      sourceUrl: this.config.connection.url,
    });
    return schema;
  }

  private async loadSchemaForData(cli: CliGlobalOptions): Promise<Schema> {
    if (cli.noCache) {
      return this.adapter.introspect();
    }

    if (cli.refresh) {
      return this.loadLiveSchema();
    }

    return (await this.cache.readFresh()) ?? this.loadLiveSchema();
  }

  private resolveCollection(schema: Schema, collectionInput: string): Collection {
    const resolvedName = resolveCollectionName(schema, collectionInput, this.config);
    return requireCollection(schema, resolvedName);
  }

  private recordPrimaryKey(collection: Collection, record: Record<string, unknown>): PrimaryKey {
    const value = record[collection.primaryKey];
    if (typeof value === "string" || typeof value === "number") {
      return value;
    }
    const fallback = record.id;
    if (typeof fallback === "string" || typeof fallback === "number") {
      return fallback;
    }
    throw new ValidationError(collection.name, collection.primaryKey, `Response for "${collection.name}" did not include a primary key.`);
  }

  private async rollback(created: CreatedRecordRef[]): Promise<void> {
    for (const entry of [...created].reverse()) {
      try {
        await this.adapter.delete(entry.collection, entry.id);
      } catch {
        // Best-effort rollback only.
      }
    }
  }

  private unwrapMutationError(error: unknown, collection?: string): Error {
    if (error instanceof MutationFailureError) {
      return error.cause;
    }
    return this.normalizeError(error, collection);
  }

  private normalizeError(error: unknown, collection?: string): Error {
    if (error instanceof Error && !isDirectusRequestError(error)) {
      return error;
    }

    if (isDirectusRequestError(error)) {
      const directusError = error;
      if (directusError.status === 401 || directusError.status === 403) {
        return new AuthError(directusError.message);
      }
      if (directusError.code === "FAILED_VALIDATION") {
        return new ValidationError(collection ?? "unknown", "unknown", directusError.message);
      }
      if (directusError.code === "RECORD_NOT_UNIQUE") {
        return new DuplicateError(collection ?? "unknown", []);
      }
      if (directusError.status === 404) {
        return new NotFoundError(collection ?? "unknown");
      }
      return new Error(directusError.message);
    }

    return new Error(String(error));
  }
}

class MutationFailureError extends Error {
  constructor(
    public override readonly cause: Error,
    public readonly created: CreatedRecordRef[],
  ) {
    super(cause.message);
    this.name = "MutationFailureError";
  }
}

function makeRef(trail: string[]): string {
  return trail.join("_").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isDirectusRequestError(error: unknown): error is {
  status: number;
  code?: string;
  message: string;
} {
  return Boolean(
    error &&
      typeof error === "object" &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number" &&
      "message" in error &&
      typeof (error as { message?: unknown }).message === "string",
  );
}

export async function readExecPlanFromStdin(): Promise<ExecPlanInput> {
  const stdin = await readStdin();
  const parsed = JSON.parse(stdin) as ExecPlanInput;
  if (!Array.isArray(parsed.operations)) {
    throw new UsageError("Exec input must be a JSON object with an operations array.");
  }
  return parsed;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function parseWhere(values: string[]): Filter {
  return Object.fromEntries(values.map((entry) => {
    const assignment = parseFilterAssignment(entry);
    return [assignment.field, assignment.value];
  }));
}
