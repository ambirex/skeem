import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { deserializeSchema, serializeSchema } from "../schema/serialization.js";
import type { CacheMeta, CacheStatus, Schema } from "../types/index.js";

export class SchemaCache {
  private readonly cacheDir: string;
  private readonly schemaPath: string;
  private readonly metaPath: string;

  constructor(
    rootDir: string,
    private readonly ttlMs: number,
    private readonly source?: { adapter: string; sourceUrl: string },
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

    // A cache written by a different adapter or backend URL describes another
    // backend entirely — within-TTL is not enough to count as fresh. The cache
    // is keyed by rootDir, so switching --adapter/--url from the same directory
    // would otherwise serve the previous backend's schema.
    if (
      this.source &&
      status.meta &&
      (status.meta.adapter !== this.source.adapter || status.meta.sourceUrl !== this.source.sourceUrl)
    ) {
      return undefined;
    }

    return this.read();
  }

  async read(): Promise<Schema | undefined> {
    try {
      const raw = await readFile(this.schemaPath, "utf8");
      return deserializeSchema(JSON.parse(raw));
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
      return {
        exists: true,
        ageMs,
        meta,
        cacheDir: this.cacheDir,
        schemaPath: this.schemaPath,
        metaPath: this.metaPath,
        ttlMs: this.ttlMs,
      };
    } catch {
      return {
        exists: false,
        cacheDir: this.cacheDir,
        schemaPath: this.schemaPath,
        metaPath: this.metaPath,
        ttlMs: this.ttlMs,
      };
    }
  }
}
