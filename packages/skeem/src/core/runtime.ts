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
  buildAnnotationRecord,
  normalizeAnnotationKey,
  parseAnnotationValue,
  resolveAnnotationExpiry,
} from "./annotations.js";
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
import { attachIdempotencyMetadata, extractIdempotencyMetadata, idempotencyRequestsMatch, type IdempotencyRequest } from "./idempotency.js";
import { isClaimActive, leaseUntilFromDuration, parseLeaseDuration, resolveClaimActor } from "./claims.js";
import { getAliasLookupCandidate, normalizeAlias } from "./identity.js";
import { buildProvenanceRecord } from "./provenance.js";
import { buildTrashRecord } from "./trash.js";
import { parseDurationMs } from "./duration.js";
import { buildVersionRecord, diffChangedFields } from "./versioning.js";
import {
  buildSystemCollectionStatus,
  getSystemCollectionDefinition,
} from "../system/tables.js";
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

interface MutationOptions {
  cli: CliGlobalOptions;
  provenance?: {
    operation: string;
    inputRefs?: unknown;
  };
  previousRecord?: EntityRecord;
}

interface LinkTargetResolution {
  collection: Collection;
  id: PrimaryKey;
  record?: EntityRecord;
}

const ALIAS_COLLECTION = "skeem_aliases";
const PROVENANCE_COLLECTION = "skeem_provenance";
const VERSIONS_COLLECTION = "skeem_versions";
const TRASH_COLLECTION = "skeem_trash";
const CLAIMS_COLLECTION = "skeem_claims";
const ANNOTATIONS_COLLECTION = "skeem_annotations";

export class SkeemRuntime {
  private readonly ensuredSystemCollections = new Set<string>();

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

  async init(cli: CliGlobalOptions, options?: { statusOnly?: boolean }): Promise<SuccessEnvelope> {
    const schema = await this.loadLiveSchema();
    const status = buildSystemCollectionStatus(schema);

    if (options?.statusOnly) {
      return toSuccessEnvelope({
        operation: "init_status",
        data: status,
        count: status.length,
      });
    }

    const missing = status.filter((entry) => !entry.exists).map((entry) => entry.collection);

    if (cli.dryRun) {
      return toSuccessEnvelope({
        operation: "dry_run",
        action: "init",
        data: {
          supported: status.length,
          missing,
          status,
        },
        count: missing.length,
      });
    }

    const created = await this.provisionSystemCollections(missing);
    const refreshedSchema = created.length > 0 ? await this.loadLiveSchema() : schema;
    const refreshedStatus = buildSystemCollectionStatus(refreshedSchema);

    return toSuccessEnvelope({
      operation: "init",
      action: created.length > 0 ? "applied" : "noop",
      data: {
        supported: refreshedStatus.length,
        applied: created,
        status: refreshedStatus,
      },
      count: refreshedStatus.length,
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
    const request = this.buildIdempotencyRequest("create", collection.name, {
      fields: this.fieldEntriesToObject(fieldEntries),
    });

    const replay = await this.maybeReplayIdempotentWrite(cli, request);
    if (replay) {
      return replay;
    }

    if (cli.dryRun) {
      return toSuccessEnvelope({
        operation: "dry_run",
        collection: collection.name,
        plan: this.previewCreate(schema, collection, node, ["root"]),
      });
    }

    try {
      const result = await this.createNode(schema, collection, node, ["root"], {
        cli,
        provenance: {
          operation: "create",
          inputRefs: {
            fields: this.fieldEntriesToObject(fieldEntries),
          },
        },
      });
      const envelope = toSuccessEnvelope({
        operation: result.plan.length > 1 ? "compound_create" : "create",
        collection: collection.name,
        data: result.record,
        plan: result.plan,
      });
      await this.persistIdempotentReplay(
        cli,
        request,
        {
          fields: this.fieldEntriesToObject(fieldEntries),
        },
        envelope,
        this.recordPrimaryKey(collection, result.record),
      );
      return envelope;
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
    const request = this.buildIdempotencyRequest("update", collection.name, {
      id,
      fields: this.fieldEntriesToObject(fieldEntries),
    });

    const replay = await this.maybeReplayIdempotentWrite(cli, request);
    if (replay) {
      return replay;
    }

    if (cli.dryRun) {
      return toSuccessEnvelope({
        operation: "dry_run",
        collection: collection.name,
        plan: this.previewUpdate(schema, collection, id, node, ["root"]),
      });
    }

    try {
      const result = await this.updateNode(schema, collection, id, node, ["root"], {
        cli,
        provenance: {
          operation: "update",
          inputRefs: {
            id,
            fields: this.fieldEntriesToObject(fieldEntries),
          },
        },
      });
      const envelope = toSuccessEnvelope({
        operation: "update",
        collection: collection.name,
        data: result.record,
        plan: result.plan,
      });
      await this.persistIdempotentReplay(
        cli,
        request,
        {
          id,
          fields: this.fieldEntriesToObject(fieldEntries),
        },
        envelope,
        this.recordPrimaryKey(collection, result.record),
      );
      return envelope;
    } catch (error) {
      if (!cli.noRollback && error instanceof MutationFailureError) {
        await this.rollback(error.created);
      }
      throw this.unwrapMutationError(error, collection.name);
    }
  }

  async delete(
    collectionInput: string,
    id: PrimaryKey,
    cli: CliGlobalOptions,
    options?: { hardDelete?: boolean },
  ): Promise<SuccessEnvelope> {
    const schema = await this.loadSchemaForData(cli);
    const collection = this.resolveCollection(schema, collectionInput);
    const hardDelete = options?.hardDelete === true;
    const request = this.buildIdempotencyRequest("delete", collection.name, {
      id,
      mode: hardDelete ? "hard" : "soft",
    });

    const replay = await this.maybeReplayIdempotentWrite(cli, request);
    if (replay) {
      return replay;
    }

    if (cli.dryRun) {
      return toSuccessEnvelope({
        operation: "dry_run",
        action: hardDelete ? "hard_delete" : "delete",
        collection: collection.name,
        plan: [
          {
            ref: "root",
            operation: "delete",
            collection: collection.name,
            data: {
              id,
              mode: hardDelete ? "hard" : "soft",
              ...(hardDelete ? {} : { trashCollection: TRASH_COLLECTION }),
            },
          },
        ],
      });
    }

    try {
      const result = hardDelete
        ? await this.hardDeleteRecord(collection, id, cli, { id })
        : await this.softDeleteRecord(collection, id, cli, { id });
      const envelope = toSuccessEnvelope({
        operation: "delete",
        action: hardDelete ? "hard_deleted" : "trashed",
        collection: collection.name,
        data: result,
      });
      await this.persistIdempotentReplay(cli, request, { id }, envelope, id);
      return envelope;
    } catch (error) {
      throw this.normalizeError(error, collection.name);
    }
  }

  async restore(collectionInput: string, id: PrimaryKey, cli: CliGlobalOptions): Promise<SuccessEnvelope> {
    const schema = await this.loadSchemaForData(cli);
    const collection = this.resolveCollection(schema, collectionInput);

    if (cli.dryRun) {
      return toSuccessEnvelope({
        operation: "dry_run",
        action: "restore",
        collection: collection.name,
        plan: [
          {
            ref: "root",
            operation: "restore",
            collection: collection.name,
            data: {
              id,
              trashCollection: TRASH_COLLECTION,
            },
          },
        ],
      });
    }

    try {
      const restored = await this.restoreRecord(collection, id);
      return toSuccessEnvelope({
        operation: "restore",
        action: restored.action,
        collection: collection.name,
        data: restored.data,
      });
    } catch (error) {
      throw this.normalizeError(error, collection.name);
    }
  }

  async claim(
    targetInput: string,
    leaseInput: string,
    purpose: string | undefined,
    cli: CliGlobalOptions,
  ): Promise<SuccessEnvelope> {
    const schema = await this.loadSchemaForData(cli);
    const target = parseRecordReference(targetInput, "record");
    const collection = this.resolveCollection(schema, target.collectionInput);
    const actor = resolveClaimActor(cli, this.config);
    const leaseMs = parseLeaseDuration(leaseInput);

    try {
      await this.adapter.get(collection.name, target.id);
      const source = { collection: collection.name, id: target.id };

      if (cli.dryRun) {
        return toSuccessEnvelope({
          operation: "dry_run",
          action: "claim",
          collection: collection.name,
          data: {
            source,
            claim: {
              claimed_by: actor,
              ...(purpose ? { purpose } : {}),
              lease_until: leaseUntilFromDuration(leaseMs),
            },
          },
          plan: [
            {
              ref: "root",
              operation: "claim",
              collection: CLAIMS_COLLECTION,
              data: {
                collection: collection.name,
                record_id: String(target.id),
                claimed_by: actor,
                ...(purpose ? { purpose } : {}),
                lease_duration: leaseInput,
              },
            },
          ],
        });
      }

      await this.ensureClaimsStore();
      const state = await this.loadClaimState(collection.name, target.id);
      const conflicting = state.active.filter((row) => String(row.claimed_by ?? "") !== actor);
      if (conflicting.length > 0) {
        const current = conflicting[0]!;
        throw new ValidationError(
          collection.name,
          "claimed_by",
          `Record "${collection.name}:${target.id}" is already claimed by "${String(current.claimed_by ?? "unknown")}" until "${String(current.lease_until ?? "unknown")}".`,
        );
      }

      let record: EntityRecord;
      let action: "claimed" | "renewed";
      const current = state.active[0];
      const payload = {
        collection: collection.name,
        record_id: String(target.id),
        claimed_by: actor,
        ...(purpose ? { purpose } : {}),
        lease_until: leaseUntilFromDuration(leaseMs),
      };

      if (current) {
        const claimId = this.extractSystemRecordId(current);
        if (claimId === undefined) {
          throw new ValidationError(CLAIMS_COLLECTION, "id", "Claim row is missing a primary key.");
        }
        record = await this.adapter.update(CLAIMS_COLLECTION, claimId, payload);
        action = "renewed";
        for (const duplicate of state.active.slice(1)) {
          await this.cleanupSystemRecordBestEffort(CLAIMS_COLLECTION, duplicate);
        }
      } else {
        record = await this.adapter.create(CLAIMS_COLLECTION, {
          ...payload,
          created_at: new Date().toISOString(),
        });
        action = "claimed";
      }

      return toSuccessEnvelope({
        operation: "claim",
        action,
        collection: collection.name,
        data: {
          source,
          claim: record,
        },
      });
    } catch (error) {
      throw this.normalizeError(error, collection.name);
    }
  }

  async claims(targetInput: string, cli: CliGlobalOptions): Promise<SuccessEnvelope> {
    const schema = await this.loadSchemaForData(cli);
    const target = parseRecordReference(targetInput, "record");
    const collection = this.resolveCollection(schema, target.collectionInput);

    try {
      await this.adapter.get(collection.name, target.id);
      const source = { collection: collection.name, id: target.id };
      const state = await this.loadClaimState(collection.name, target.id);
      const claim = state.active[0] ?? null;
      return toSuccessEnvelope({
        operation: "claims",
        action: claim ? "claimed" : "unclaimed",
        collection: collection.name,
        data: {
          source,
          claim,
        },
        count: claim ? 1 : 0,
      });
    } catch (error) {
      throw this.normalizeError(error, collection.name);
    }
  }

  async release(targetInput: string, cli: CliGlobalOptions): Promise<SuccessEnvelope> {
    const schema = await this.loadSchemaForData(cli);
    const target = parseRecordReference(targetInput, "record");
    const collection = this.resolveCollection(schema, target.collectionInput);
    const actor = resolveClaimActor(cli, this.config);

    try {
      await this.adapter.get(collection.name, target.id);
      const source = { collection: collection.name, id: target.id };
      const state = await this.loadClaimState(collection.name, target.id);
      const active = state.active;

      if (cli.dryRun) {
        return toSuccessEnvelope({
          operation: "dry_run",
          action: "release",
          collection: collection.name,
          data: {
            source,
            claim: active[0] ?? null,
            released: active.filter((row) => String(row.claimed_by ?? "") === actor).length,
          },
          plan: [
            {
              ref: "root",
              operation: "release",
              collection: CLAIMS_COLLECTION,
              data: {
                collection: collection.name,
                record_id: String(target.id),
                actor,
              },
            },
          ],
        });
      }

      if (active.length === 0) {
        return toSuccessEnvelope({
          operation: "release",
          action: "not_claimed",
          collection: collection.name,
          data: {
            source,
            claim: null,
            released: 0,
          },
        });
      }

      const conflicting = active.filter((row) => String(row.claimed_by ?? "") !== actor);
      if (conflicting.length > 0) {
        const current = conflicting[0]!;
        throw new ValidationError(
          collection.name,
          "claimed_by",
          `Record "${collection.name}:${target.id}" is claimed by "${String(current.claimed_by ?? "unknown")}" and cannot be released by "${actor}".`,
        );
      }

      let released = 0;
      for (const row of active) {
        const claimId = this.extractSystemRecordId(row);
        if (claimId === undefined) {
          continue;
        }
        await this.adapter.delete(CLAIMS_COLLECTION, claimId);
        released += 1;
      }

      return toSuccessEnvelope({
        operation: "release",
        action: released > 0 ? "released" : "not_claimed",
        collection: collection.name,
        data: {
          source,
          claim: active[0] ?? null,
          released,
        },
      });
    } catch (error) {
      throw this.normalizeError(error, collection.name);
    }
  }

  async annotate(
    targetInput: string,
    keyInput: string,
    valueInput: string,
    expiresInput: string | undefined,
    cli: CliGlobalOptions,
  ): Promise<SuccessEnvelope> {
    const schema = await this.loadSchemaForData(cli);
    const target = parseRecordReference(targetInput, "record");
    const collection = this.resolveCollection(schema, target.collectionInput);
    const key = normalizeAnnotationKey(keyInput);
    const value = parseAnnotationValue(valueInput);
    const expiresMs = expiresInput ? parseDurationMs(expiresInput, "--expires") : undefined;
    const expiresAt = resolveAnnotationExpiry(expiresInput);
    const request = this.buildIdempotencyRequest("annotate", collection.name, {
      recordId: target.id,
      key,
      value,
      ...(expiresMs !== undefined ? { expiresMs } : {}),
    });

    const replay = await this.maybeReplayIdempotentWrite(cli, request);
    if (replay) {
      return replay;
    }

    try {
      await this.adapter.get(collection.name, target.id);
      const source = { collection: collection.name, id: target.id };
      const annotation = buildAnnotationRecord({
        collection: collection.name,
        recordId: target.id,
        key,
        value,
        cli,
        config: this.config,
        ...(expiresAt ? { expiresAt } : {}),
      });

      if (cli.dryRun) {
        return toSuccessEnvelope({
          operation: "dry_run",
          action: "annotate",
          collection: collection.name,
          data: {
            source,
            annotation,
          },
          plan: [
            {
              ref: "root",
              operation: "annotate",
              collection: ANNOTATIONS_COLLECTION,
              data: annotation,
            },
          ],
        });
      }

      await this.ensureAnnotationStore();
      const record = await this.adapter.create(ANNOTATIONS_COLLECTION, annotation);
      const envelope = toSuccessEnvelope({
        operation: "annotate",
        action: "annotated",
        collection: collection.name,
        data: {
          source,
          annotation: record,
        },
      });
      await this.recordProvenance({
        collection: collection.name,
        recordId: target.id,
        operation: "annotate",
        cli,
        inputRefs: cli.idempotencyKey
          ? this.prepareIdempotentInputRefs(request, {
            key,
            value,
            ...(expiresAt ? { expires_at: expiresAt } : {}),
          }, envelope)
          : {
            key,
            value,
            ...(expiresAt ? { expires_at: expiresAt } : {}),
          },
      });
      return envelope;
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
    const request = this.buildIdempotencyRequest("upsert", collection.name, {
      match,
      fields: this.fieldEntriesToObject(fieldEntries),
    });
    let decision: ReturnType<typeof resolveUpsertDecision>;

    const replay = await this.maybeReplayIdempotentWrite(cli, request);
    if (replay) {
      return replay;
    }

    try {
      const matches = await this.findIdentityMatches(collection, match);
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
        const result = await this.createNode(schema, collection, createNode, ["root"], {
          cli,
          provenance: {
            operation: "upsert",
            inputRefs: {
              action: "created",
              match,
              fields: this.fieldEntriesToObject(fieldEntries),
            },
          },
        });
        const envelope = toSuccessEnvelope({
          operation: "upsert",
          action: "created",
          collection: collection.name,
          data: result.record,
          plan: result.plan,
        });
        await this.persistIdempotentReplay(
          cli,
          request,
          {
            action: "created",
            match,
            fields: this.fieldEntriesToObject(fieldEntries),
          },
          envelope,
          this.recordPrimaryKey(collection, result.record),
        );
        return envelope;
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
      const result = await this.updateNode(schema, collection, id, node, ["root"], {
        cli,
        previousRecord: decision.record,
        provenance: {
          operation: "upsert",
          inputRefs: {
            action: "updated",
            id,
            match,
            fields: this.fieldEntriesToObject(fieldEntries),
          },
        },
      });
      const envelope = toSuccessEnvelope({
        operation: "upsert",
        action: "updated",
        collection: collection.name,
        data: result.record,
        plan: result.plan,
      });
      await this.persistIdempotentReplay(
        cli,
        request,
        {
          action: "updated",
          id,
          match,
          fields: this.fieldEntriesToObject(fieldEntries),
        },
        envelope,
        this.recordPrimaryKey(collection, result.record),
      );
      return envelope;
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
    const parsed = parseLinkArguments(relationOrTargetInput, targetInput);
    const relation = resolveRelation(sourceCollection, parsed.relationInput);
    const inputRefs = this.buildRelationInputRefs(sourceCollection.name, sourceReference.id, relation.field, parsed.target);
    const request = this.buildIdempotencyRequest("link", sourceCollection.name, inputRefs);

    const replay = await this.maybeReplayIdempotentWrite(cli, request);
    if (replay) {
      return replay;
    }

    try {
      const sourceRecord = await this.adapter.get(sourceCollection.name, sourceReference.id);
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
        const envelope = toSuccessEnvelope({
          operation: "link",
          action: "linked",
          collection: sourceCollection.name,
          data: {
            ...this.describeRelationMutation("linked", true, sourceCollection, sourceReference.id, relation, target),
            record,
          },
          plan: [this.buildRelationPlanEntry("link", sourceCollection.name, sourceReference.id, relation, target)],
        });
        await this.recordProvenance({
          collection: sourceCollection.name,
          recordId: sourceReference.id,
          operation: "link",
          cli,
          inputRefs: cli.idempotencyKey ? this.prepareIdempotentInputRefs(request, inputRefs, envelope) : inputRefs,
        });
        return envelope;
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
      const envelope = toSuccessEnvelope({
        operation: "link",
        action: "linked",
        collection: sourceCollection.name,
        data: {
          ...this.describeRelationMutation("linked", true, sourceCollection, sourceReference.id, relation, target, mutation.junction!.collection),
          record,
        },
        plan: [this.buildRelationPlanEntry("link", sourceCollection.name, sourceReference.id, relation, target, mutation.junction!.collection)],
      });
      await this.recordProvenance({
        collection: sourceCollection.name,
        recordId: sourceReference.id,
        operation: "link",
        cli,
        inputRefs: cli.idempotencyKey ? this.prepareIdempotentInputRefs(request, inputRefs, envelope) : inputRefs,
      });
      return envelope;
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
    const parsed = parseLinkArguments(relationOrTargetInput, targetInput);
    const relation = resolveRelation(sourceCollection, parsed.relationInput);
    const inputRefs = this.buildRelationInputRefs(sourceCollection.name, sourceReference.id, relation.field, parsed.target);
    const request = this.buildIdempotencyRequest("unlink", sourceCollection.name, inputRefs);

    const replay = await this.maybeReplayIdempotentWrite(cli, request);
    if (replay) {
      return replay;
    }

    try {
      const sourceRecord = await this.adapter.get(sourceCollection.name, sourceReference.id);
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
        const envelope = toSuccessEnvelope({
          operation: "unlink",
          action: "unlinked",
          collection: sourceCollection.name,
          data: {
            ...this.describeRelationMutation("unlinked", true, sourceCollection, sourceReference.id, relation, target),
            record,
          },
          plan: [this.buildRelationPlanEntry("unlink", sourceCollection.name, sourceReference.id, relation, target)],
        });
        await this.recordProvenance({
          collection: sourceCollection.name,
          recordId: sourceReference.id,
          operation: "unlink",
          cli,
          inputRefs: cli.idempotencyKey ? this.prepareIdempotentInputRefs(request, inputRefs, envelope) : inputRefs,
        });
        return envelope;
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
      const envelope = toSuccessEnvelope({
        operation: "unlink",
        action: "unlinked",
        collection: sourceCollection.name,
        data: {
          ...this.describeRelationMutation("unlinked", true, sourceCollection, sourceReference.id, relation, target, mutation.junction!.collection),
          removed,
        },
        plan: [this.buildRelationPlanEntry("unlink", sourceCollection.name, sourceReference.id, relation, target, mutation.junction!.collection)],
      });
      await this.recordProvenance({
        collection: sourceCollection.name,
        recordId: sourceReference.id,
        operation: "unlink",
        cli,
        inputRefs: cli.idempotencyKey ? this.prepareIdempotentInputRefs(request, inputRefs, envelope) : inputRefs,
      });

      return envelope;
    } catch (error) {
      throw this.normalizeError(error, sourceCollection.name);
    }
  }

  async aliasAdd(targetInput: string, alias: string, cli: CliGlobalOptions): Promise<SuccessEnvelope> {
    const normalized = normalizeAlias(alias);
    if (normalized.length === 0) {
      throw new UsageError("Alias must contain letters or numbers after normalization.");
    }

    const schema = await this.loadLiveSchema();
    const target = parseRecordReference(targetInput, "record");
    const collection = this.resolveCollection(schema, target.collectionInput);

    try {
      await this.adapter.get(collection.name, target.id);
    } catch (error) {
      throw this.normalizeError(error, collection.name);
    }

    await this.ensureAliasStore();

    try {
      const existing = await this.findAliasRows({
        collection: collection.name,
        alias_normalized: normalized,
      }, { limit: 100 });
      const sameRecord = existing.find((row) => String(row.record_id ?? "") === String(target.id));
      if (sameRecord) {
        return toSuccessEnvelope({
          operation: "alias_add",
          action: "exists",
          collection: collection.name,
          data: sameRecord,
        });
      }
      if (existing.length > 0) {
        throw new DuplicateError(ALIAS_COLLECTION, ["collection", "alias_normalized"]);
      }

      const record = await this.adapter.create(ALIAS_COLLECTION, {
        collection: collection.name,
        record_id: String(target.id),
        alias,
        alias_normalized: normalized,
        ...(cli.actor ? { created_by: cli.actor } : {}),
        created_at: new Date().toISOString(),
      });

      return toSuccessEnvelope({
        operation: "alias_add",
        action: "added",
        collection: collection.name,
        data: record,
      });
    } catch (error) {
      throw this.normalizeError(error, ALIAS_COLLECTION);
    }
  }

  async aliasList(targetInput: string, cli: CliGlobalOptions): Promise<SuccessEnvelope> {
    const schema = await this.loadSchemaForData(cli);
    const target = parseRecordReference(targetInput, "record");
    const collection = this.resolveCollection(schema, target.collectionInput);
    const rows = await this.findAliasRows({
      collection: collection.name,
      record_id: String(target.id),
    }, { limit: 1000 });
    const data = [...rows].sort((left, right) => String(left.alias ?? "").localeCompare(String(right.alias ?? "")));

    return toSuccessEnvelope({
      operation: "alias_list",
      collection: collection.name,
      data,
      count: data.length,
    });
  }

  async aliasRemove(targetInput: string, alias: string, cli: CliGlobalOptions): Promise<SuccessEnvelope> {
    const normalized = normalizeAlias(alias);
    if (normalized.length === 0) {
      throw new UsageError("Alias must contain letters or numbers after normalization.");
    }

    const schema = await this.loadSchemaForData(cli);
    const target = parseRecordReference(targetInput, "record");
    const collection = this.resolveCollection(schema, target.collectionInput);
    const rows = await this.findAliasRows({
      collection: collection.name,
      record_id: String(target.id),
      alias_normalized: normalized,
    }, { limit: 100 });

    for (const row of rows) {
      const aliasId = row.id;
      if (typeof aliasId !== "string" && typeof aliasId !== "number") {
        continue;
      }
      await this.adapter.delete(ALIAS_COLLECTION, aliasId);
    }

    return toSuccessEnvelope({
      operation: "alias_remove",
      action: rows.length > 0 ? "removed" : "not_found",
      collection: collection.name,
      data: {
        alias,
        alias_normalized: normalized,
        removed: rows.length,
      },
    });
  }

  async aliasSearch(collectionInput: string, term: string, cli: CliGlobalOptions): Promise<SuccessEnvelope> {
    const normalized = normalizeAlias(term);
    if (normalized.length === 0) {
      throw new UsageError("Alias search term must contain letters or numbers after normalization.");
    }

    const schema = await this.loadSchemaForData(cli);
    const collection = this.resolveCollection(schema, collectionInput);
    const rows = await this.findAliasRows({ collection: collection.name }, { limit: 1000 });
    const data = rows
      .filter((row) => typeof row.alias_normalized === "string" && row.alias_normalized.includes(normalized))
      .sort((left, right) => String(left.alias ?? "").localeCompare(String(right.alias ?? "")));

    return toSuccessEnvelope({
      operation: "alias_search",
      collection: collection.name,
      data,
      count: data.length,
    });
  }

  async exec(planInput: ExecPlanInput, cli: CliGlobalOptions): Promise<SuccessEnvelope> {
    if (cli.idempotencyKey) {
      throw new UsageError("Idempotency replay is not supported for skeem exec yet.");
    }

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
            const recordId = this.recordPrimaryKey(requireCollection(schema, collection), result);
            created.push({ collection, id: recordId });
            await this.recordProvenance({
              collection,
              recordId,
              operation: "create",
              cli,
              inputRefs: operation,
            });
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
            result = await this.applyAuditedUpdate(requireCollection(schema, collection), resolved.id, resolved.data ?? {}, {
              cli,
              provenance: {
                operation: "update",
                inputRefs: operation,
              },
            });
            break;
          }
          case "delete": {
            if (resolved.id === undefined) {
              throw new UsageError(`Exec operation "${resolved.ref}" is missing an id.`);
            }
            result = await this.softDeleteRecord(requireCollection(schema, collection), resolved.id, cli, operation);
            break;
          }
          case "upsert": {
            result = await this.executeExecUpsert(schema, resolved, cli, operation);
            break;
          }
          case "link": {
            result = await this.executeExecRelationMutation(schema, resolved, "link", cli, operation);
            break;
          }
          case "unlink": {
            result = await this.executeExecRelationMutation(schema, resolved, "unlink", cli, operation);
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

  private async createNode(
    schema: Schema,
    collection: Collection,
    node: InputNode,
    trail: string[],
    options: MutationOptions,
  ): Promise<MutationResult> {
    const data: Record<string, unknown> = { ...node.fields };
    const plan: OperationLogEntry[] = [];
    const created: CreatedRecordRef[] = [];

    try {
      for (const [segment, childNode] of Object.entries(node.children)) {
        const relation = resolveRelation(collection, segment);
        const childResult = await this.resolveRelationInput(schema, relation, childNode, [...trail, segment], this.withoutIdempotencyKey(options.cli));
        data[relation.field] = childResult.id;
        plan.push(...childResult.plan);
        created.push(...childResult.created);
      }

      const record = await this.adapter.create(collection.name, data);
      const id = this.recordPrimaryKey(collection, record);
      created.push({ collection: collection.name, id });
      await this.recordProvenance({
        collection: collection.name,
        recordId: id,
        operation: options.provenance?.operation ?? "create",
        cli: options.cli,
        inputRefs: options.provenance?.inputRefs ?? this.describeNodeInput(node, trail),
      });
      plan.push({
        ref: makeRef(trail),
        operation: "create",
        collection: collection.name,
        data: record,
      });
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
    options: MutationOptions,
  ): Promise<MutationResult> {
    const created: CreatedRecordRef[] = [];
    const data: Record<string, unknown> = { ...node.fields };
    const plan: OperationLogEntry[] = [];

    try {
      for (const [segment, childNode] of Object.entries(node.children)) {
        const relation = resolveRelation(collection, segment);
        const childResult = await this.resolveRelationInput(schema, relation, childNode, [...trail, segment], this.withoutIdempotencyKey(options.cli));
        data[relation.field] = childResult.id;
        created.push(...childResult.created);
        plan.push(...childResult.plan);
      }

      const record = await this.applyAuditedUpdate(collection, id, data, {
        cli: options.cli,
        previousRecord: options.previousRecord,
        provenance: {
          operation: options.provenance?.operation ?? "update",
          inputRefs: options.provenance?.inputRefs ?? this.describeNodeInput(node, trail, { id }),
        },
      });
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
    cli: CliGlobalOptions,
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

      const record = await this.resolveIdentityRecord(targetCollection, node.selector.filter);
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
        const record = await this.resolveIdentityRecord(targetCollection, node.selector.filter);
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
        const created = await this.createNode(schema, targetCollection, createNode, trail, { cli });
        return {
          id: this.recordPrimaryKey(targetCollection, created.record),
          plan: created.plan,
          created: created.created,
        };
      }
    }

    const created = await this.createNode(schema, targetCollection, node, trail, { cli });
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
        const record = await this.resolveIdentityRecord(targetCollection, parsed.filter);
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

  private async resolveIdentityRecord(collection: Collection, filter: Filter): Promise<EntityRecord> {
    const matches = await this.findIdentityMatches(collection, filter);
    if (matches.length === 0) {
      throw new NotFoundError(collection.name, undefined, filter);
    }
    if (matches.length > 1) {
      throw new AmbiguousError(collection.name, filter, matches.length);
    }
    return matches[0]!;
  }

  private async findIdentityMatches(collection: Collection, filter: Filter): Promise<EntityRecord[]> {
    const directMatches = await this.adapter.find(collection.name, filter, { limit: 2 });
    if (directMatches.length > 0) {
      return directMatches;
    }

    const candidate = getAliasLookupCandidate(filter);
    if (!candidate) {
      return [];
    }

    const aliasRows = await this.findAliasRows({
      collection: collection.name,
      alias_normalized: candidate.normalized,
    }, { limit: 25 });
    const recordIds = Array.from(new Set(
      aliasRows
        .map((row) => row.record_id)
        .filter((value): value is string | number => typeof value === "string" || typeof value === "number"),
    ));

    const matches: EntityRecord[] = [];
    for (const recordId of recordIds) {
      try {
        matches.push(await this.adapter.get(collection.name, recordId));
      } catch (error) {
        const normalized = this.normalizeError(error, collection.name);
        if (normalized instanceof NotFoundError) {
          continue;
        }
        throw normalized;
      }

      if (matches.length >= 2) {
        break;
      }
    }

    return matches;
  }

  private async ensureAliasStore(): Promise<void> {
    await this.ensureSystemCollection(ALIAS_COLLECTION);
  }

  private async ensureProvenanceStore(): Promise<void> {
    await this.ensureSystemCollection(PROVENANCE_COLLECTION);
  }

  private async ensureVersionStore(): Promise<void> {
    await this.ensureSystemCollection(VERSIONS_COLLECTION);
  }

  private async ensureTrashStore(): Promise<void> {
    await this.ensureSystemCollection(TRASH_COLLECTION);
  }

  private async ensureClaimsStore(): Promise<void> {
    await this.ensureSystemCollection(CLAIMS_COLLECTION);
  }

  private async ensureAnnotationStore(): Promise<void> {
    await this.ensureSystemCollection(ANNOTATIONS_COLLECTION);
  }

  private async findAliasRows(
    filter: Filter,
    options?: { limit?: number },
  ): Promise<EntityRecord[]> {
    try {
      return await this.adapter.find(ALIAS_COLLECTION, filter, {
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
      });
    } catch (error) {
      if (
        isDirectusRequestError(error) &&
        (error.status === 404 || (error.status === 403 && /does not exist/i.test(error.message)))
      ) {
        return [];
      }
      throw error;
    }
  }

  private async findTrashRows(
    filter: Filter,
    options?: { limit?: number; sort?: string },
  ): Promise<EntityRecord[]> {
    try {
      return await this.adapter.find(TRASH_COLLECTION, filter, {
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
        ...(options?.sort ? { sort: options.sort } : {}),
      });
    } catch (error) {
      if (
        isDirectusRequestError(error) &&
        (error.status === 404 || (error.status === 403 && /does not exist/i.test(error.message)))
      ) {
        return [];
      }
      throw error;
    }
  }

  private async findClaimRows(
    filter: Filter,
    options?: { limit?: number; sort?: string },
  ): Promise<EntityRecord[]> {
    try {
      return await this.adapter.find(CLAIMS_COLLECTION, filter, {
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
        ...(options?.sort ? { sort: options.sort } : {}),
      });
    } catch (error) {
      if (
        isDirectusRequestError(error) &&
        (error.status === 404 || (error.status === 403 && /does not exist/i.test(error.message)))
      ) {
        return [];
      }
      throw error;
    }
  }

  private async findProvenanceRows(
    filter: Filter,
    options?: { limit?: number; sort?: string },
  ): Promise<EntityRecord[]> {
    try {
      return await this.adapter.find(PROVENANCE_COLLECTION, filter, {
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
        ...(options?.sort ? { sort: options.sort } : {}),
      });
    } catch (error) {
      if (
        isDirectusRequestError(error) &&
        (error.status === 404 || (error.status === 403 && /does not exist/i.test(error.message)))
      ) {
        return [];
      }
      throw error;
    }
  }

  private async provisionSystemCollections(names: string[]): Promise<string[]> {
    if (names.length === 0) {
      return [];
    }

    if (!this.adapter.createCollection) {
      throw new UsageError(`Adapter "${this.adapter.name}" does not support system table creation.`);
    }

    const schema = await this.loadCurrentSchema({ writeCache: true });
    const created: string[] = [];

    for (const name of names) {
      if (schema.collections.has(name)) {
        this.ensuredSystemCollections.add(name);
        continue;
      }

      const definition = getSystemCollectionDefinition(name);
      if (!definition) {
        throw new UsageError(`Unsupported system table "${name}".`);
      }

      await this.adapter.createCollection({
        name: definition.name,
        fields: definition.fields.map((field) => ({ ...field })),
      });
      created.push(name);
      this.ensuredSystemCollections.add(name);
    }

    if (created.length > 0) {
      await this.loadCurrentSchema({ writeCache: true });
    }

    return created;
  }

  private async ensureSystemCollection(name: string): Promise<void> {
    if (this.ensuredSystemCollections.has(name)) {
      return;
    }

    const schema = await this.loadCurrentSchema({ writeCache: true });
    if (schema.collections.has(name)) {
      this.ensuredSystemCollections.add(name);
      return;
    }

    await this.provisionSystemCollections([name]);
    this.ensuredSystemCollections.add(name);
  }

  private async recordProvenance(input: {
    collection: string;
    recordId: PrimaryKey;
    operation: string;
    cli: CliGlobalOptions;
    inputRefs?: unknown;
  }): Promise<EntityRecord> {
    await this.ensureProvenanceStore();
    return this.adapter.create(PROVENANCE_COLLECTION, buildProvenanceRecord({
      collection: input.collection,
      recordId: input.recordId,
      operation: input.operation,
      cli: input.cli,
      config: this.config,
      inputRefs: input.inputRefs,
    }));
  }

  private buildIdempotencyRequest(operation: string, collection: string, input: unknown): IdempotencyRequest {
    return {
      operation,
      collection,
      input,
    };
  }

  private async maybeReplayIdempotentWrite(cli: CliGlobalOptions, request: IdempotencyRequest): Promise<SuccessEnvelope | null> {
    if (cli.dryRun || !cli.idempotencyKey) {
      return null;
    }

    await this.ensureProvenanceStore();
    const rows = await this.findProvenanceRows({
      idempotency_key: cli.idempotencyKey,
    }, {
      limit: 10,
      sort: "-created_at",
    });
    if (rows.length === 0) {
      return null;
    }

    const matches = rows
      .map((row) => ({ row, metadata: extractIdempotencyMetadata(row.input_refs) }))
      .filter((entry) => entry.metadata && idempotencyRequestsMatch(entry.metadata.request, request));

    if (matches.length === 1) {
      return toSuccessEnvelope(matches[0]!.metadata!.response);
    }

    if (matches.length > 1) {
      throw new ValidationError(request.collection, "idempotency_key", `Idempotency key "${cli.idempotencyKey}" matched multiple stored responses and cannot be replayed safely.`);
    }

    if (rows.length === 1 && extractIdempotencyMetadata(rows[0]!.input_refs) === null) {
      throw new ValidationError(request.collection, "idempotency_key", `Idempotency key "${cli.idempotencyKey}" exists but predates replay metadata support.`);
    }

    throw new ValidationError(request.collection, "idempotency_key", `Idempotency key "${cli.idempotencyKey}" is already associated with a different request.`);
  }

  private prepareIdempotentInputRefs(
    request: IdempotencyRequest,
    rawInputRefs: unknown,
    envelope: SuccessEnvelope,
  ): unknown {
    const { ok: _ok, ...response } = envelope;
    return attachIdempotencyMetadata(rawInputRefs, request, response);
  }

  private async persistIdempotentReplay(
    cli: CliGlobalOptions,
    request: IdempotencyRequest,
    rawInputRefs: unknown,
    envelope: SuccessEnvelope,
    recordId: PrimaryKey,
  ): Promise<void> {
    if (!cli.idempotencyKey) {
      return;
    }

    const rows = await this.findProvenanceRows({
      idempotency_key: cli.idempotencyKey,
      collection: request.collection,
      record_id: String(recordId),
      operation: request.operation,
    }, {
      limit: 5,
      sort: "-created_at",
    });
    const provenance = rows[0];
    const provenanceId = this.extractSystemRecordId(provenance);
    if (provenanceId === undefined) {
      throw new ValidationError(request.collection, "idempotency_key", `Idempotency key "${cli.idempotencyKey}" could not be attached to provenance metadata.`);
    }

    await this.adapter.update(PROVENANCE_COLLECTION, provenanceId, {
      input_refs: this.prepareIdempotentInputRefs(request, rawInputRefs, envelope),
    });
  }

  private withoutIdempotencyKey(cli: CliGlobalOptions): CliGlobalOptions {
    if (!cli.idempotencyKey) {
      return cli;
    }

    const { idempotencyKey: _idempotencyKey, ...rest } = cli;
    return rest;
  }

  private async recordVersion(input: {
    collection: Collection;
    recordId: PrimaryKey;
    snapshot: EntityRecord;
    record: EntityRecord;
    provenance?: EntityRecord;
  }): Promise<EntityRecord | null> {
    const changedFields = diffChangedFields(input.snapshot, input.record);
    if (changedFields.length === 0) {
      return null;
    }

    await this.ensureVersionStore();
    const latestVersion = await this.readLatestVersion(input.collection.name, input.recordId);
    const provenanceId = this.extractSystemRecordId(input.provenance);

    return this.adapter.create(VERSIONS_COLLECTION, buildVersionRecord({
      collection: input.collection.name,
      recordId: input.recordId,
      version: latestVersion + 1,
      snapshot: input.snapshot,
      changedFields,
      ...(provenanceId !== undefined ? { provenanceId } : {}),
    }));
  }

  private async recordTrash(input: {
    collection: Collection;
    recordId: PrimaryKey;
    snapshot: EntityRecord;
    cli: CliGlobalOptions;
    provenance?: EntityRecord;
  }): Promise<EntityRecord> {
    await this.ensureTrashStore();
    const provenanceId = this.extractSystemRecordId(input.provenance);
    return this.adapter.create(TRASH_COLLECTION, buildTrashRecord({
      collection: input.collection.name,
      recordId: input.recordId,
      snapshot: input.snapshot,
      cli: input.cli,
      config: this.config,
      ...(provenanceId !== undefined ? { provenanceId } : {}),
    }));
  }

  private async loadClaimState(collection: string, recordId: PrimaryKey): Promise<{ active: EntityRecord[]; expired: EntityRecord[] }> {
    const rows = await this.findClaimRows({
      collection,
      record_id: String(recordId),
    }, {
      limit: 100,
      sort: "-lease_until",
    });
    const active: EntityRecord[] = [];
    const expired: EntityRecord[] = [];

    for (const row of rows) {
      if (isClaimActive(row)) {
        active.push(row);
      } else {
        expired.push(row);
      }
    }

    for (const row of expired) {
      await this.cleanupSystemRecordBestEffort(CLAIMS_COLLECTION, row);
    }

    return { active, expired };
  }

  private async readLatestVersion(collection: string, recordId: PrimaryKey): Promise<number> {
    const rows = await this.adapter.find(VERSIONS_COLLECTION, {
      collection,
      record_id: String(recordId),
    }, {
      limit: 1,
      sort: "-version",
    });
    const value = rows[0]?.version;
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && value.length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return 0;
  }

  private async applyAuditedUpdate(
    collection: Collection,
    id: PrimaryKey,
    data: Record<string, unknown>,
    options: {
      cli: CliGlobalOptions;
      provenance: {
        operation: string;
        inputRefs?: unknown;
      };
      previousRecord?: EntityRecord;
    },
  ): Promise<EntityRecord> {
    const previousRecord = options.previousRecord ?? await this.adapter.get(collection.name, id);
    const record = await this.adapter.update(collection.name, id, data);
    const provenance = await this.recordProvenance({
      collection: collection.name,
      recordId: id,
      operation: options.provenance.operation,
      cli: options.cli,
      inputRefs: options.provenance.inputRefs,
    });
    await this.recordVersion({
      collection,
      recordId: id,
      snapshot: previousRecord,
      record,
      provenance,
    });
    return record;
  }

  private async softDeleteRecord(
    collection: Collection,
    id: PrimaryKey,
    cli: CliGlobalOptions,
    inputRefs?: unknown,
  ): Promise<Record<string, unknown>> {
    const snapshot = await this.adapter.get(collection.name, id);
    let provenance: EntityRecord | undefined;
    let trash: EntityRecord | undefined;

    try {
      provenance = await this.recordProvenance({
        collection: collection.name,
        recordId: id,
        operation: "delete",
        cli,
        inputRefs,
      });
      trash = await this.recordTrash({
        collection,
        recordId: id,
        snapshot,
        cli,
        ...(provenance ? { provenance } : {}),
      });
      await this.adapter.delete(collection.name, id);
    } catch (error) {
      await this.cleanupSystemRecordBestEffort(TRASH_COLLECTION, trash);
      await this.cleanupSystemRecordBestEffort(PROVENANCE_COLLECTION, provenance);
      throw error;
    }

    return {
      id,
      trashed: true,
      ...(this.extractSystemRecordId(trash) !== undefined ? { trashId: this.extractSystemRecordId(trash) } : {}),
    };
  }

  private async hardDeleteRecord(
    collection: Collection,
    id: PrimaryKey,
    cli: CliGlobalOptions,
    inputRefs?: unknown,
  ): Promise<Record<string, unknown>> {
    await this.adapter.delete(collection.name, id);
    await this.recordProvenance({
      collection: collection.name,
      recordId: id,
      operation: "delete",
      cli,
      inputRefs,
    });
    return {
      id,
      trashed: false,
    };
  }

  private async restoreRecord(
    collection: Collection,
    id: PrimaryKey,
  ): Promise<{ action: string; data: Record<string, unknown> }> {
    const trashRows = await this.findTrashRows({
      collection: collection.name,
      record_id: String(id),
    }, {
      limit: 1,
      sort: "-deleted_at",
    });
    const trash = trashRows[0];
    if (!trash) {
      throw new NotFoundError(TRASH_COLLECTION, id, {
        collection: collection.name,
        record_id: String(id),
      });
    }

    const existing = await this.adapter.find(collection.name, {
      [collection.primaryKey]: id,
    }, {
      limit: 1,
    });
    if (existing.length > 0) {
      throw new ValidationError(collection.name, collection.primaryKey, `Cannot restore "${collection.name}" because id "${id}" is already in use.`);
    }

    const snapshot = trash.snapshot;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new ValidationError(TRASH_COLLECTION, "snapshot", `Trash entry for "${collection.name}" does not contain a restorable snapshot.`);
    }

    const record = await this.adapter.create(collection.name, snapshot as Record<string, unknown>);
    let action = "restored";
    try {
      await this.cleanupSystemRecord(TRASH_COLLECTION, trash);
    } catch {
      action = "restored_with_residual_trash";
    }

    return {
      action,
      data: {
        id,
        record,
      },
    };
  }

  private extractSystemRecordId(record?: EntityRecord): string | number | undefined {
    if (!record) {
      return undefined;
    }
    const id = record.id;
    return typeof id === "string" || typeof id === "number" ? id : undefined;
  }

  private async cleanupSystemRecord(collection: string, record?: EntityRecord): Promise<void> {
    const id = this.extractSystemRecordId(record);
    if (id === undefined) {
      return;
    }
    await this.adapter.delete(collection, id);
  }

  private async cleanupSystemRecordBestEffort(collection: string, record?: EntityRecord): Promise<void> {
    try {
      await this.cleanupSystemRecord(collection, record);
    } catch {
      // Best-effort cleanup only.
    }
  }

  private describeNodeInput(
    node: InputNode,
    trail: string[],
    extras?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      trail: trail.join("."),
      fields: node.fields,
      ...(node.selector ? { selector: node.selector } : {}),
      ...(Object.keys(node.children).length > 0 ? { relations: Object.keys(node.children) } : {}),
      ...(extras ?? {}),
    };
  }

  private buildRelationInputRefs(
    collection: string,
    id: PrimaryKey,
    relation: string,
    target: ReturnType<typeof parseLinkArguments>["target"],
  ): Record<string, unknown> {
    return {
      source: {
        collection,
        id,
      },
      relation,
      target: {
        ...(target.collectionInput ? { collection: target.collectionInput } : {}),
        ...(target.kind === "resolve" ? { filter: target.filter } : { id: target.id }),
      },
    };
  }

  private fieldEntriesToObject(fieldEntries: Array<[string, string]>): Record<string, string> {
    return Object.fromEntries(fieldEntries);
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

  private async executeExecUpsert(
    schema: Schema,
    operation: ExecOperationInput,
    cli: CliGlobalOptions,
    inputRefs: unknown,
  ): Promise<Record<string, unknown>> {
    const collection = this.resolveCollection(schema, operation.collection);
    try {
      const match = this.expectExecFilter(operation.match, `Exec operation "${operation.ref}" is missing a match object.`);
      const data = this.expectExecRecordObject(operation.data ?? {}, `Exec operation "${operation.ref}" data must be an object.`);
      const matches = await this.findIdentityMatches(collection, match);
      const decision = resolveUpsertDecision(collection, match, matches);

      if (decision.kind === "create") {
        const record = await this.adapter.create(collection.name, mergeUpsertCreateData(data, match, collection.name));
        await this.recordProvenance({
          collection: collection.name,
          recordId: this.recordPrimaryKey(collection, record),
          operation: "upsert",
          cli,
          inputRefs,
        });
        return record;
      }

      const id = this.recordPrimaryKey(collection, decision.record);
      return this.applyAuditedUpdate(collection, id, data, {
        cli,
        previousRecord: decision.record,
        provenance: {
          operation: "upsert",
          inputRefs,
        },
      });
    } catch (error) {
      throw this.normalizeError(error, collection.name);
    }
  }

  private async executeExecRelationMutation(
    schema: Schema,
    operation: ExecOperationInput,
    mode: "link" | "unlink",
    cli: CliGlobalOptions,
    inputRefs: unknown,
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
        await this.recordProvenance({
          collection: sourceCollection.name,
          recordId: operation.id,
          operation: mode,
          cli,
          inputRefs,
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
        await this.recordProvenance({
          collection: sourceCollection.name,
          recordId: operation.id,
          operation: mode,
          cli,
          inputRefs,
        });
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
      await this.recordProvenance({
        collection: sourceCollection.name,
        recordId: operation.id,
        operation: mode,
        cli,
        inputRefs,
      });

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
