import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import YAML from "yaml";

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
import { describeCollection, schemaToDocument } from "../schema/serialization.js";
import { loadSchemaDocument } from "../schema/document.js";
import { diffSchemaDocuments } from "../schema/diff.js";
import { buildDefinePlan } from "../schema/plan.js";
import { buildInputNode, parseFilterAssignment, resolveRefs, topoSortOperations } from "./values.js";
import {
  buildLinkMutationPlan,
  buildUnlinkMutationPlan,
  mergeUpsertCreateData,
  mergeUpsertCreateNode,
  parseExecLinkOperation,
  parseLinkArguments,
  parseRecordReference,
  resolveUpsertDecision,
} from "./data-verbs.js";
import { toSuccessEnvelope } from "../output/formatter.js";
import type {
  CliGlobalOptions,
  Collection,
  DiffDirection,
  EntityRecord,
  ExecPlanInput,
  ExecOperationInput,
  FieldType,
  Filter,
  InputNode,
  OperationLogEntry,
  PrimaryKey,
  Relation,
  ResolvedConfig,
  Schema,
  SchemaPlanEntry,
  SchemaPlanSummary,
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

interface LinkTargetResolution {
  collection: Collection;
  id: PrimaryKey;
  record?: EntityRecord;
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

  async describe(collectionInput: string): Promise<SuccessEnvelope> {
    const schema = await this.loadLiveSchema();
    const collection = this.resolveCollection(schema, collectionInput);
    const summary = describeCollection(collection);

    return toSuccessEnvelope({
      operation: "describe",
      collection: collection.name,
      data: {
        ...summary,
        ...(this.adapter.count ? { count: await this.adapter.count(collection.name) } : {}),
      },
    });
  }

  async discover(options: {
    collections: string[];
    outputPath?: string;
  }): Promise<SuccessEnvelope> {
    const schema = await this.loadLiveSchema();
    const available = filterCollections(schema, this.config);
    const selectedNames = options.collections.length > 0
      ? options.collections.map((input) => this.resolveCollection(schema, input).name)
      : available.map((collection) => collection.name);
    const dedupedSelectedNames = Array.from(new Set(selectedNames));

    const document = schemaToDocument(schema, {
      name: deduceSchemaDocumentName(this.config),
      collections: dedupedSelectedNames,
    });

    if (options.outputPath) {
      const absolutePath = path.resolve(this.config.rootDir, options.outputPath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, stringifyDiscoveredDocument(document));

      return toSuccessEnvelope({
        operation: "discover",
        data: {
          path: absolutePath,
          schema: document,
        },
      });
    }

    return toSuccessEnvelope({
      operation: "discover",
      data: document,
    });
  }

  async diff(
    schemaPathInput: string,
    options: {
      direction: DiffDirection;
      cli: CliGlobalOptions;
    },
  ): Promise<SuccessEnvelope> {
    const absolutePath = path.resolve(this.config.rootDir, schemaPathInput);
    const fileDocument = await loadSchemaDocument(absolutePath);
    const liveSchema = await this.loadCurrentSchema({ writeCache: !options.cli.noCache });
    const liveDocument = schemaToDocument(liveSchema, {
      name: deduceSchemaDocumentName(this.config),
      collections: filterCollections(liveSchema, this.config).map((collection) => collection.name),
    });
    const diff = diffSchemaDocuments(fileDocument, liveDocument, options.direction);

    return toSuccessEnvelope({
      operation: "diff",
      data: {
        path: absolutePath,
        ...diff,
      },
      count: diff.changes.length,
    });
  }

  async define(schemaPathInput: string, cli: CliGlobalOptions): Promise<SuccessEnvelope> {
    const absolutePath = path.resolve(this.config.rootDir, schemaPathInput);
    const fileDocument = await loadSchemaDocument(absolutePath);
    const liveSchema = await this.loadCurrentSchema({ writeCache: !cli.noCache });
    const liveDocument = schemaToDocument(liveSchema, {
      name: deduceSchemaDocumentName(this.config),
      collections: filterCollections(liveSchema, this.config).map((collection) => collection.name),
    });
    const built = buildDefinePlan(fileDocument, liveDocument);

    if (cli.dryRun) {
      return toSuccessEnvelope({
        operation: "dry_run",
        action: "define",
        data: {
          path: absolutePath,
          summary: built.summary,
        },
        plan: built.plan,
        count: built.plan.length,
      });
    }

    const plan = built.plan.map((entry) => this.preparePlanEntry(entry, cli.allowDestructive));
    const executable = plan.filter((entry) => entry.executable && entry.status === "planned");

    if (executable.length > 0) {
      await confirmSchemaPlanExecution(plan, cli);
    }

    for (const entry of executable) {
      await this.applySchemaPlanEntry(entry);
      entry.status = "applied";
    }

    await this.loadCurrentSchema({ writeCache: true });
    const summary = summarizeSchemaPlan(plan);

    return toSuccessEnvelope({
      operation: "define",
      action: "define",
      data: {
        path: absolutePath,
        summary,
        applied: summary.applied,
        skipped: summary.skipped,
      },
      plan,
      count: plan.length,
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
      return toSuccessEnvelope({
        operation: "dry_run",
        collection: collection.name,
        plan: this.previewUpdate(schema, collection, id, node, ["root"]),
      });
    }

    try {
      const result = await this.updateNode(schema, collection, id, node, ["root"]);
      return toSuccessEnvelope({
        operation: "update",
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

  async upsert(
    collectionInput: string,
    match: Filter,
    fieldEntries: Array<[string, string]>,
    cli: CliGlobalOptions,
  ): Promise<SuccessEnvelope> {
    if (Object.keys(match).length === 0) {
      throw new UsageError("Usage: skeem upsert <collection> --match field=value [--field value]");
    }

    const schema = await this.loadSchemaForData(cli);
    const collection = this.resolveCollection(schema, collectionInput);
    const node = buildInputNode(fieldEntries, collection.name);
    let decision: ReturnType<typeof resolveUpsertDecision>;

    try {
      const matches = await this.adapter.find(collection.name, match, { limit: 2 });
      decision = resolveUpsertDecision(collection, match, matches);
    } catch (error) {
      throw this.normalizeError(error, collection.name);
    }

    if (decision.kind === "create") {
      const createNode = mergeUpsertCreateNode(node, match, collection.name);

      if (cli.dryRun) {
        return toSuccessEnvelope({
          operation: "dry_run",
          action: "upsert",
          collection: collection.name,
          data: {
            action: "created",
            match,
          },
          plan: this.previewCreate(schema, collection, createNode, ["root"]),
        });
      }

      try {
        const result = await this.createNode(schema, collection, createNode, ["root"]);
        return toSuccessEnvelope({
          operation: "upsert",
          action: "created",
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

    const id = this.recordPrimaryKey(collection, decision.record);

    if (cli.dryRun) {
      return toSuccessEnvelope({
        operation: "dry_run",
        action: "upsert",
        collection: collection.name,
        data: {
          action: "updated",
          id,
          match,
        },
        plan: this.previewUpdate(schema, collection, id, node, ["root"]),
      });
    }

    try {
      const result = await this.updateNode(schema, collection, id, node, ["root"]);
      return toSuccessEnvelope({
        operation: "upsert",
        action: "updated",
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

  async link(
    sourceInput: string,
    relationOrTargetInput: string,
    targetInput: string | undefined,
    cli: CliGlobalOptions,
  ): Promise<SuccessEnvelope> {
    const schema = await this.loadSchemaForData(cli);
    const sourceReference = parseRecordReference(sourceInput, "source");
    const sourceCollection = this.resolveCollection(schema, sourceReference.collectionInput);

    try {
      const sourceRecord = await this.adapter.get(sourceCollection.name, sourceReference.id);
      const parsed = parseLinkArguments(relationOrTargetInput, targetInput);
      const relation = resolveRelation(sourceCollection, parsed.relationInput);
      const target = await this.resolveLinkTarget(schema, relation, parsed.target, true);
      const mutation = buildLinkMutationPlan(relation, sourceReference.id, target.id);

      if (mutation.kind === "m2o") {
        const currentTarget = sourceRecord[relation.field];
        const changed = currentTarget !== target.id;

        if (cli.dryRun) {
          return toSuccessEnvelope({
            operation: "dry_run",
            action: "link",
            collection: sourceCollection.name,
            data: this.describeRelationMutation("linked", changed, sourceCollection, sourceReference.id, relation, target),
            plan: [this.buildRelationPlanEntry("link", sourceCollection.name, sourceReference.id, relation, target)],
          });
        }

        if (!changed) {
          return toSuccessEnvelope({
            operation: "link",
            action: "already_linked",
            collection: sourceCollection.name,
            data: this.describeRelationMutation("already_linked", false, sourceCollection, sourceReference.id, relation, target),
          });
        }

        const record = await this.adapter.update(sourceCollection.name, sourceReference.id, {
          [mutation.update!.field]: mutation.update!.value,
        });
        return toSuccessEnvelope({
          operation: "link",
          action: "linked",
          collection: sourceCollection.name,
          data: {
            ...this.describeRelationMutation("linked", true, sourceCollection, sourceReference.id, relation, target),
            record,
          },
          plan: [this.buildRelationPlanEntry("link", sourceCollection.name, sourceReference.id, relation, target)],
        });
      }

      const existing = await this.adapter.find(mutation.junction!.collection, mutation.junction!.filter, { limit: 1 });
      const changed = existing.length === 0;

      if (cli.dryRun) {
        return toSuccessEnvelope({
          operation: "dry_run",
          action: "link",
          collection: sourceCollection.name,
          data: this.describeRelationMutation("linked", changed, sourceCollection, sourceReference.id, relation, target, mutation.junction!.collection),
          plan: [this.buildRelationPlanEntry("link", sourceCollection.name, sourceReference.id, relation, target, mutation.junction!.collection)],
        });
      }

      if (!changed) {
        return toSuccessEnvelope({
          operation: "link",
          action: "already_linked",
          collection: sourceCollection.name,
          data: this.describeRelationMutation(
            "already_linked",
            false,
            sourceCollection,
            sourceReference.id,
            relation,
            target,
            mutation.junction!.collection,
          ),
        });
      }

      const record = await this.adapter.create(mutation.junction!.collection, mutation.junction!.data);
      return toSuccessEnvelope({
        operation: "link",
        action: "linked",
        collection: sourceCollection.name,
        data: {
          ...this.describeRelationMutation("linked", true, sourceCollection, sourceReference.id, relation, target, mutation.junction!.collection),
          record,
        },
        plan: [this.buildRelationPlanEntry("link", sourceCollection.name, sourceReference.id, relation, target, mutation.junction!.collection)],
      });
    } catch (error) {
      throw this.normalizeError(error, sourceCollection.name);
    }
  }

  async unlink(
    sourceInput: string,
    relationOrTargetInput: string,
    targetInput: string | undefined,
    cli: CliGlobalOptions,
  ): Promise<SuccessEnvelope> {
    const schema = await this.loadSchemaForData(cli);
    const sourceReference = parseRecordReference(sourceInput, "source");
    const sourceCollection = this.resolveCollection(schema, sourceReference.collectionInput);

    try {
      const sourceRecord = await this.adapter.get(sourceCollection.name, sourceReference.id);
      const parsed = parseLinkArguments(relationOrTargetInput, targetInput);
      const relation = resolveRelation(sourceCollection, parsed.relationInput);
      const target = await this.resolveLinkTarget(schema, relation, parsed.target, false);
      const mutation = buildUnlinkMutationPlan(relation, sourceReference.id, target.id);

      if (mutation.kind === "m2o") {
        const currentTarget = sourceRecord[relation.field];
        const changed = currentTarget === target.id;

        if (cli.dryRun) {
          return toSuccessEnvelope({
            operation: "dry_run",
            action: "unlink",
            collection: sourceCollection.name,
            data: this.describeRelationMutation("unlinked", changed, sourceCollection, sourceReference.id, relation, target),
            plan: [this.buildRelationPlanEntry("unlink", sourceCollection.name, sourceReference.id, relation, target)],
          });
        }

        if (!changed) {
          return toSuccessEnvelope({
            operation: "unlink",
            action: "already_unlinked",
            collection: sourceCollection.name,
            data: this.describeRelationMutation("already_unlinked", false, sourceCollection, sourceReference.id, relation, target),
          });
        }

        const record = await this.adapter.update(sourceCollection.name, sourceReference.id, {
          [mutation.update!.field]: mutation.update!.value,
        });
        return toSuccessEnvelope({
          operation: "unlink",
          action: "unlinked",
          collection: sourceCollection.name,
          data: {
            ...this.describeRelationMutation("unlinked", true, sourceCollection, sourceReference.id, relation, target),
            record,
          },
          plan: [this.buildRelationPlanEntry("unlink", sourceCollection.name, sourceReference.id, relation, target)],
        });
      }

      const existing = await this.adapter.find(mutation.junction!.collection, mutation.junction!.filter, { limit: 100 });
      const removed = existing.length;

      if (cli.dryRun) {
        return toSuccessEnvelope({
          operation: "dry_run",
          action: "unlink",
          collection: sourceCollection.name,
          data: {
            ...this.describeRelationMutation("unlinked", removed > 0, sourceCollection, sourceReference.id, relation, target, mutation.junction!.collection),
            removed,
          },
          plan: [this.buildRelationPlanEntry("unlink", sourceCollection.name, sourceReference.id, relation, target, mutation.junction!.collection)],
        });
      }

      if (removed === 0) {
        return toSuccessEnvelope({
          operation: "unlink",
          action: "already_unlinked",
          collection: sourceCollection.name,
          data: {
            ...this.describeRelationMutation(
              "already_unlinked",
              false,
              sourceCollection,
              sourceReference.id,
              relation,
              target,
              mutation.junction!.collection,
            ),
            removed,
          },
        });
      }

      const junctionCollection = requireCollection(schema, mutation.junction!.collection);
      for (const row of existing) {
        await this.adapter.delete(mutation.junction!.collection, this.recordPrimaryKey(junctionCollection, row));
      }

      return toSuccessEnvelope({
        operation: "unlink",
        action: "unlinked",
        collection: sourceCollection.name,
        data: {
          ...this.describeRelationMutation("unlinked", true, sourceCollection, sourceReference.id, relation, target, mutation.junction!.collection),
          removed,
        },
        plan: [this.buildRelationPlanEntry("unlink", sourceCollection.name, sourceReference.id, relation, target, mutation.junction!.collection)],
      });
    } catch (error) {
      throw this.normalizeError(error, sourceCollection.name);
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
        plan: ordered.map((operation) => this.previewExecOperation(schema, operation)),
      });
    }

    try {
      for (const operation of ordered) {
        const resolved = resolveRefs(operation, context);
        const collection = this.resolveCollection(schema, resolved.collection).name;
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
          case "upsert": {
            result = await this.executeExecUpsert(schema, resolved);
            break;
          }
          case "link": {
            result = await this.executeExecRelationMutation(schema, resolved, "link");
            break;
          }
          case "unlink": {
            result = await this.executeExecRelationMutation(schema, resolved, "unlink");
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

  private async updateNode(
    schema: Schema,
    collection: Collection,
    id: PrimaryKey,
    node: InputNode,
    trail: string[],
  ): Promise<MutationResult> {
    const created: CreatedRecordRef[] = [];
    const data: Record<string, unknown> = { ...node.fields };
    const plan: OperationLogEntry[] = [];

    try {
      for (const [segment, childNode] of Object.entries(node.children)) {
        const relation = resolveRelation(collection, segment);
        const childResult = await this.resolveRelationInput(schema, relation, childNode, [...trail, segment]);
        data[relation.field] = childResult.id;
        created.push(...childResult.created);
        plan.push(...childResult.plan);
      }

      const record = await this.adapter.update(collection.name, id, data);
      plan.push({
        ref: makeRef(trail),
        operation: "update",
        collection: collection.name,
        data: record,
      });

      return {
        record,
        plan,
        created,
      };
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
    const data: Record<string, unknown> = { ...node.fields };

    for (const [segment, childNode] of Object.entries(node.children)) {
      const relation = resolveRelation(collection, segment);
      const targetCollection = requireCollection(schema, relation.relatedCollection);
      const ref = makeRef([...trail, segment]);

      if (childNode.selector?.kind === "id") {
        data[relation.field] = childNode.selector.id;
        plan.push({
          ref,
          operation: "reference",
          collection: targetCollection.name,
          data: { id: childNode.selector.id },
        });
        continue;
      }

      if (childNode.selector?.kind === "resolve") {
        data[relation.field] = {
          resolve: childNode.selector.filter,
        };
        plan.push({
          ref,
          operation: "resolve",
          collection: targetCollection.name,
          data: childNode.selector.filter,
        });
        continue;
      }

      if (childNode.selector?.kind === "resolveOrCreate") {
        data[relation.field] = {
          resolveOrCreate: childNode.selector.filter,
          ref: `${ref}.id`,
        };
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
      data[relation.field] = `$${ref}.id`;
    }

    plan.push({
      ref: makeRef(trail),
      operation: "create",
      collection: collection.name,
      data,
    });
    return plan;
  }

  private previewUpdate(schema: Schema, collection: Collection, id: PrimaryKey, node: InputNode, trail: string[]): OperationLogEntry[] {
    const plan: OperationLogEntry[] = [];
    const data: Record<string, unknown> = { ...node.fields };

    for (const [segment, childNode] of Object.entries(node.children)) {
      const relation = resolveRelation(collection, segment);
      const targetCollection = requireCollection(schema, relation.relatedCollection);
      const ref = makeRef([...trail, segment]);

      if (childNode.selector?.kind === "id") {
        data[relation.field] = childNode.selector.id;
        plan.push({
          ref,
          operation: "reference",
          collection: targetCollection.name,
          data: { id: childNode.selector.id },
        });
        continue;
      }

      if (childNode.selector?.kind === "resolve") {
        data[relation.field] = {
          resolve: childNode.selector.filter,
        };
        plan.push({
          ref,
          operation: "resolve",
          collection: targetCollection.name,
          data: childNode.selector.filter,
        });
        continue;
      }

      if (childNode.selector?.kind === "resolveOrCreate") {
        data[relation.field] = {
          resolveOrCreate: childNode.selector.filter,
          ref: `${ref}.id`,
        };
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
      data[relation.field] = `$${ref}.id`;
    }

    plan.push({
      ref: makeRef(trail),
      operation: "update",
      collection: collection.name,
      data: {
        id,
        fields: data,
      },
    });

    return plan;
  }

  private async resolveLinkTarget(
    schema: Schema,
    relation: Relation,
    parsed: ReturnType<typeof parseLinkArguments>["target"],
    requireExisting: boolean,
  ): Promise<LinkTargetResolution> {
    const targetCollection = requireCollection(schema, relation.relatedCollection);

    if (parsed.kind === "resolve") {
      if (parsed.collectionInput) {
        const resolvedCollection = this.resolveCollection(schema, parsed.collectionInput);
        if (resolvedCollection.name !== targetCollection.name) {
          throw new UsageError(
            `Relation "${relation.field}" expects records from "${targetCollection.name}" but received "${resolvedCollection.name}".`,
          );
        }
      }

      try {
        const record = await this.adapter.findOne(targetCollection.name, parsed.filter);
        return {
          collection: targetCollection,
          id: this.recordPrimaryKey(targetCollection, record),
          record,
        };
      } catch (error) {
        throw this.normalizeError(error, targetCollection.name);
      }
    }

    if (parsed.collectionInput) {
      const resolvedCollection = this.resolveCollection(schema, parsed.collectionInput);
      if (resolvedCollection.name !== targetCollection.name) {
        throw new UsageError(
          `Relation "${relation.field}" expects records from "${targetCollection.name}" but received "${resolvedCollection.name}".`,
        );
      }
    }

    if (!requireExisting) {
      return {
        collection: targetCollection,
        id: parsed.id,
      };
    }

    try {
      const record = await this.adapter.get(targetCollection.name, parsed.id);
      return {
        collection: targetCollection,
        id: this.recordPrimaryKey(targetCollection, record),
        record,
      };
    } catch (error) {
      throw this.normalizeError(error, targetCollection.name);
    }
  }

  private buildRelationPlanEntry(
    operation: "link" | "unlink",
    sourceCollection: string,
    sourceId: PrimaryKey,
    relation: Relation,
    target: LinkTargetResolution,
    junctionCollection?: string,
  ): OperationLogEntry {
    return {
      ref: "root",
      operation,
      collection: sourceCollection,
      action: operation,
      data: {
        id: sourceId,
        relation: relation.field,
        target: {
          collection: target.collection.name,
          id: target.id,
        },
        type: relation.type,
        ...(junctionCollection ? { junctionCollection } : {}),
      },
    };
  }

  private describeRelationMutation(
    action: "linked" | "already_linked" | "unlinked" | "already_unlinked",
    changed: boolean,
    sourceCollection: Collection,
    sourceId: PrimaryKey,
    relation: Relation,
    target: LinkTargetResolution,
    junctionCollection?: string,
  ): Record<string, unknown> {
    return {
      action,
      changed,
      source: {
        collection: sourceCollection.name,
        id: sourceId,
      },
      relation: {
        field: relation.field,
        type: relation.type,
        collection: target.collection.name,
      },
      target: {
        collection: target.collection.name,
        id: target.id,
      },
      ...(junctionCollection ? { junctionCollection } : {}),
    };
  }

  private previewExecOperation(schema: Schema, operation: ExecOperationInput): OperationLogEntry {
    const collection = this.resolveCollection(schema, operation.collection);

    switch (operation.op) {
      case "create":
      case "get":
      case "find":
      case "findOne":
      case "update":
      case "delete":
        return {
          ref: operation.ref,
          operation: operation.op,
          collection: collection.name,
          data: {
            ...(operation.id !== undefined ? { id: operation.id } : {}),
            ...(operation.filter ? { filter: operation.filter } : {}),
            ...(operation.data ? { data: operation.data } : {}),
          },
        };
      case "upsert": {
        const match = this.expectExecRecordObject(operation.match, `Exec operation "${operation.ref}" is missing a match object.`);
        return {
          ref: operation.ref,
          operation: operation.op,
          collection: collection.name,
          data: {
            match,
            ...(operation.data ? { data: operation.data } : {}),
          },
        };
      }
      case "link":
      case "unlink": {
        if (operation.id === undefined) {
          throw new UsageError(`Exec operation "${operation.ref}" is missing an id.`);
        }
        const parsed = parseExecLinkOperation({
          relation: operation.relation,
          target: operation.target,
        });
        const relation = resolveRelation(collection, parsed.relationInput);
        return {
          ref: operation.ref,
          operation: operation.op,
          collection: collection.name,
          data: {
            id: operation.id,
            relation: relation.field,
            type: relation.type,
            target: operation.target,
          },
        };
      }
      default:
        throw new UsageError(`Unsupported exec operation "${(operation as { op: string }).op}".`);
    }
  }

  private async executeExecUpsert(schema: Schema, operation: ExecOperationInput): Promise<Record<string, unknown>> {
    const collection = this.resolveCollection(schema, operation.collection);
    try {
      const match = this.expectExecFilter(operation.match, `Exec operation "${operation.ref}" is missing a match object.`);
      const data = this.expectExecRecordObject(operation.data ?? {}, `Exec operation "${operation.ref}" data must be an object.`);
      const matches = await this.adapter.find(collection.name, match, { limit: 2 });
      const decision = resolveUpsertDecision(collection, match, matches);

      if (decision.kind === "create") {
        return this.adapter.create(collection.name, mergeUpsertCreateData(data, match, collection.name));
      }

      const id = this.recordPrimaryKey(collection, decision.record);
      return this.adapter.update(collection.name, id, data);
    } catch (error) {
      throw this.normalizeError(error, collection.name);
    }
  }

  private async executeExecRelationMutation(
    schema: Schema,
    operation: ExecOperationInput,
    mode: "link" | "unlink",
  ): Promise<Record<string, unknown>> {
    const sourceCollection = this.resolveCollection(schema, operation.collection);
    try {
      if (operation.id === undefined) {
        throw new UsageError(`Exec operation "${operation.ref}" is missing an id.`);
      }

      const sourceRecord = await this.adapter.get(sourceCollection.name, operation.id);
      const parsed = parseExecLinkOperation({
        relation: operation.relation,
        target: operation.target,
      });
      const relation = resolveRelation(sourceCollection, parsed.relationInput);
      const target = await this.resolveLinkTarget(schema, relation, parsed.target, mode === "link");
      const mutation = mode === "link"
        ? buildLinkMutationPlan(relation, operation.id, target.id)
        : buildUnlinkMutationPlan(relation, operation.id, target.id);

      if (mutation.kind === "m2o") {
        const currentTarget = sourceRecord[relation.field];
        const changed = mode === "link"
          ? currentTarget !== target.id
          : currentTarget === target.id;

        if (!changed) {
          return this.describeRelationMutation(
            mode === "link" ? "already_linked" : "already_unlinked",
            false,
            sourceCollection,
            operation.id,
            relation,
            target,
          );
        }

        const record = await this.adapter.update(sourceCollection.name, operation.id, {
          [mutation.update!.field]: mutation.update!.value,
        });
        return {
          ...this.describeRelationMutation(
            mode === "link" ? "linked" : "unlinked",
            true,
            sourceCollection,
            operation.id,
            relation,
            target,
          ),
          record,
        };
      }

      const existing = await this.adapter.find(mutation.junction!.collection, mutation.junction!.filter, {
        limit: mode === "link" ? 1 : 100,
      });

      if (mode === "link") {
        if (existing.length > 0) {
          return this.describeRelationMutation("already_linked", false, sourceCollection, operation.id, relation, target, mutation.junction!.collection);
        }

        const record = await this.adapter.create(mutation.junction!.collection, mutation.junction!.data);
        return {
          ...this.describeRelationMutation("linked", true, sourceCollection, operation.id, relation, target, mutation.junction!.collection),
          record,
        };
      }

      if (existing.length === 0) {
        return {
          ...this.describeRelationMutation("already_unlinked", false, sourceCollection, operation.id, relation, target, mutation.junction!.collection),
          removed: 0,
        };
      }

      const junctionCollection = requireCollection(schema, mutation.junction!.collection);
      for (const row of existing) {
        await this.adapter.delete(mutation.junction!.collection, this.recordPrimaryKey(junctionCollection, row));
      }

      return {
        ...this.describeRelationMutation("unlinked", true, sourceCollection, operation.id, relation, target, mutation.junction!.collection),
        removed: existing.length,
      };
    } catch (error) {
      throw this.normalizeError(error, sourceCollection.name);
    }
  }

  private expectExecRecordObject(value: unknown, message: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new UsageError(message);
    }
    return value as Record<string, unknown>;
  }

  private expectExecFilter(value: unknown, message: string): Filter {
    return this.expectExecRecordObject(value, message) as Filter;
  }

  private async loadLiveSchema(): Promise<Schema> {
    return this.loadCurrentSchema({ writeCache: true });
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

  private async loadCurrentSchema(options: { writeCache: boolean }): Promise<Schema> {
    const schema = await this.adapter.introspect();
    if (options.writeCache) {
      await this.cache.write(schema, {
        savedAt: new Date().toISOString(),
        adapter: this.adapter.name,
        sourceUrl: this.config.connection.url,
      });
    }
    return schema;
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

  private preparePlanEntry(entry: SchemaPlanEntry, allowDestructive: boolean): SchemaPlanEntry {
    if (entry.executable && (!entry.destructive || allowDestructive)) {
      return entry;
    }

    const reason = entry.reason ?? (entry.destructive
      ? "Destructive schema actions require --allow-destructive."
      : "This schema action is not executable yet.");

    return {
      ...entry,
      status: "skipped",
      reason,
    };
  }

  private async applySchemaPlanEntry(entry: SchemaPlanEntry): Promise<void> {
    switch (entry.action) {
      case "create_collection": {
        if (!this.adapter.createCollection) {
          throw new UsageError(`Adapter "${this.adapter.name}" does not support schema collection creation.`);
        }
        const fields = Array.isArray(entry.details?.fields)
          ? entry.details.fields
          : [];
        await this.adapter.createCollection({
          name: entry.collection ?? "",
          fields: fields as Array<{
            name: string;
            type: FieldType;
            required?: boolean;
            unique?: boolean;
            default?: unknown;
            enum?: string[];
            clearDefault?: boolean;
          }>,
        });
        return;
      }
      case "create_field": {
        if (!this.adapter.createField) {
          throw new UsageError(`Adapter "${this.adapter.name}" does not support schema field creation.`);
        }
        const field = entry.details?.field;
        if (!entry.collection || !field || typeof field !== "object") {
          throw new UsageError(`Schema plan entry "${entry.summary}" is missing field details.`);
        }
        await this.adapter.createField(entry.collection, field as {
          name: string;
          type: FieldType;
          required?: boolean;
          unique?: boolean;
          default?: unknown;
          enum?: string[];
          clearDefault?: boolean;
        });
        return;
      }
      case "update_field": {
        if (!this.adapter.updateField) {
          throw new UsageError(`Adapter "${this.adapter.name}" does not support schema field updates.`);
        }
        const field = entry.details?.field;
        if (!entry.collection || !entry.field || !field || typeof field !== "object") {
          throw new UsageError(`Schema plan entry "${entry.summary}" is missing field details.`);
        }
        await this.adapter.updateField(entry.collection, entry.field, field as {
          name: string;
          type: FieldType;
          required?: boolean;
          unique?: boolean;
          default?: unknown;
          enum?: string[];
          clearDefault?: boolean;
        });
        return;
      }
      case "create_relation": {
        if (!this.adapter.createRelation) {
          throw new UsageError(`Adapter "${this.adapter.name}" does not support relation creation.`);
        }
        const relation = entry.details?.relation;
        if (!relation || typeof relation !== "object") {
          throw new UsageError(`Schema plan entry "${entry.summary}" is missing relation details.`);
        }
        await this.adapter.createRelation(relation as {
          collection: string;
          field: string;
          relatedCollection: string;
          type: Relation["type"];
          inverseField?: string;
          junctionCollection?: string;
          junctionField?: string;
          inverseJunctionField?: string;
        });
        return;
      }
      case "create_many_to_many_relation": {
        if (!this.adapter.createRelation) {
          throw new UsageError(`Adapter "${this.adapter.name}" does not support many-to-many relation creation.`);
        }
        const relation = entry.details?.relation;
        if (!relation || typeof relation !== "object") {
          throw new UsageError(`Schema plan entry "${entry.summary}" is missing many-to-many details.`);
        }
        await this.adapter.createRelation(relation as {
          collection: string;
          field: string;
          relatedCollection: string;
          type: Relation["type"];
          inverseField?: string;
          junctionCollection?: string;
          junctionField?: string;
          inverseJunctionField?: string;
        });
        return;
      }
      case "remove_field": {
        if (!this.adapter.deleteField) {
          throw new UsageError(`Adapter "${this.adapter.name}" does not support schema field deletion.`);
        }
        if (!entry.collection || !entry.field) {
          throw new UsageError(`Schema plan entry "${entry.summary}" is missing field details.`);
        }
        await this.adapter.deleteField(entry.collection, entry.field);
        return;
      }
      case "remove_collection": {
        if (!this.adapter.deleteCollection) {
          throw new UsageError(`Adapter "${this.adapter.name}" does not support schema collection deletion.`);
        }
        if (!entry.collection) {
          throw new UsageError(`Schema plan entry "${entry.summary}" is missing collection details.`);
        }
        await this.adapter.deleteCollection(entry.collection);
        return;
      }
      case "remove_relation":
      case "remove_many_to_many_relation": {
        if (!this.adapter.deleteRelation) {
          throw new UsageError(`Adapter "${this.adapter.name}" does not support relation deletion.`);
        }
        const relation = entry.details?.relation;
        if (!relation || typeof relation !== "object") {
          throw new UsageError(`Schema plan entry "${entry.summary}" is missing relation details.`);
        }
        await this.adapter.deleteRelation(relation as {
          collection: string;
          field: string;
          relatedCollection: string;
          type: Relation["type"];
          inverseField?: string;
          junctionCollection?: string;
          junctionField?: string;
          inverseJunctionField?: string;
        });
        return;
      }
      case "update_relation": {
        if (!this.adapter.updateRelation) {
          throw new UsageError(`Adapter "${this.adapter.name}" does not support relation updates.`);
        }
        const relation = entry.details?.relation;
        if (!relation || typeof relation !== "object") {
          throw new UsageError(`Schema plan entry "${entry.summary}" is missing relation details.`);
        }
        await this.adapter.updateRelation(relation as {
          collection: string;
          field: string;
          relatedCollection: string;
          type: Relation["type"];
          currentRelatedCollection?: string;
          currentType?: Relation["type"];
          inverseField?: string;
          junctionCollection?: string;
          junctionField?: string;
          inverseJunctionField?: string;
          currentInverseField?: string;
          currentJunctionCollection?: string;
          currentJunctionField?: string;
          currentInverseJunctionField?: string;
        });
        return;
      }
      default:
        throw new UsageError(`Schema plan action "${entry.action}" is not executable yet.`);
    }
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

function deduceSchemaDocumentName(config: ResolvedConfig): string {
  try {
    const url = new URL(config.connection.url);
    return url.hostname.replace(/\./g, "-");
  } catch {
    return "discovered-schema";
  }
}

function stringifyDiscoveredDocument(document: ReturnType<typeof schemaToDocument>): string {
  return YAML.stringify(document);
}

function summarizeSchemaPlan(plan: SchemaPlanEntry[]): SchemaPlanSummary {
  return plan.reduce<SchemaPlanSummary>((summary, entry) => ({
    total: summary.total + 1,
    executable: summary.executable + (entry.executable ? 1 : 0),
    destructive: summary.destructive + (entry.destructive ? 1 : 0),
    blocked: summary.blocked + (!entry.executable ? 1 : 0),
    applied: summary.applied + (entry.status === "applied" ? 1 : 0),
    skipped: summary.skipped + (entry.status === "skipped" ? 1 : 0),
  }), {
    total: 0,
    executable: 0,
    destructive: 0,
    blocked: 0,
    applied: 0,
    skipped: 0,
  });
}

async function confirmSchemaPlanExecution(plan: SchemaPlanEntry[], cli: CliGlobalOptions): Promise<void> {
  if (cli.yes) {
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new UsageError("Define execution requires --yes when running non-interactively.");
  }

  const executable = plan.filter((entry) => entry.executable && entry.status === "planned");
  const skipped = plan.filter((entry) => entry.status === "skipped");
  const prompt = skipped.length > 0
    ? `Execute ${executable.length} schema action(s) and skip ${skipped.length} blocked action(s)? [y/N] `
    : `Execute ${executable.length} schema action(s)? [y/N] `;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(prompt);
    if (!/^y(es)?$/i.test(answer.trim())) {
      throw new UsageError("Define cancelled.");
    }
  } finally {
    rl.close();
  }
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
  if (stdin.trim().length === 0) {
    throw new UsageError("Exec input must be a JSON object with an operations array.");
  }

  let parsed: ExecPlanInput;
  try {
    parsed = JSON.parse(stdin) as ExecPlanInput;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`Exec input must be valid JSON: ${message}`);
  }

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
