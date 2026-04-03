import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CacheMeta, CacheStatus, Collection, Field, Relation, Schema, UniqueConstraint } from "../types/index.js";

interface SerializedSchema {
  collections: Array<{
    name: string;
    primaryKey: string;
    fields: Field[];
    relations: Relation[];
    uniqueConstraints: UniqueConstraint[];
  }>;
}

export class SchemaCache {
  private readonly cacheDir: string;
  private readonly schemaPath: string;
  private readonly metaPath: string;

  constructor(
    rootDir: string,
    private readonly ttlMs: number,
  ) {
    this.cacheDir = path.join(rootDir, ".skeem", "cache");
    this.schemaPath = path.join(this.cacheDir, "schema.json");
    this.metaPath = path.join(this.cacheDir, "meta.json");
  }

  async readFresh(): Promise<Schema | undefined> {
    const status = await this.status();
    if (!status.exists || status.ageMs === undefined || status.ageMs > this.ttlMs) {
      return undefined;
    }

    return this.read();
  }

  async read(): Promise<Schema | undefined> {
    try {
      const raw = await readFile(this.schemaPath, "utf8");
      return deserializeSchema(JSON.parse(raw) as SerializedSchema);
    } catch {
      return undefined;
    }
  }

  async write(schema: Schema, meta: CacheMeta): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(this.schemaPath, JSON.stringify(serializeSchema(schema), null, 2));
    await writeFile(this.metaPath, JSON.stringify(meta, null, 2));
  }

  async clear(): Promise<void> {
    await rm(this.cacheDir, { recursive: true, force: true });
  }

  async status(): Promise<CacheStatus> {
    try {
      const metaRaw = await readFile(this.metaPath, "utf8");
      const meta = JSON.parse(metaRaw) as CacheMeta;
      const ageMs = Date.now() - new Date(meta.savedAt).getTime();
      return { exists: true, ageMs, meta };
    } catch {
      return { exists: false };
    }
  }
}

function serializeSchema(schema: Schema): SerializedSchema {
  return {
    collections: Array.from(schema.collections.values()).map((collection) => ({
      name: collection.name,
      primaryKey: collection.primaryKey,
      fields: Array.from(collection.fields.values()),
      relations: collection.relations,
      uniqueConstraints: collection.uniqueConstraints,
    })),
  };
}

function deserializeSchema(serialized: SerializedSchema): Schema {
  return {
    collections: new Map(
      serialized.collections.map((collection) => [
        collection.name,
        {
          name: collection.name,
          primaryKey: collection.primaryKey,
          fields: new Map(collection.fields.map((field) => [field.name, field])),
          relations: collection.relations,
          uniqueConstraints: collection.uniqueConstraints,
        } satisfies Collection,
      ]),
    ),
  };
}
