import { UsageError } from "../errors/index.js";
import type { AdapterConfig, SkemAdapter } from "../types/index.js";

type AdapterFactory = () => SkemAdapter;

/**
 * Maps an adapter name to a lazy loader. Using dynamic `import()` means only the
 * selected adapter's module is evaluated at runtime, even though every adapter
 * package is a dependency of the CLI.
 */
const REGISTRY: Record<string, () => Promise<AdapterFactory>> = {
  directus: async () => (await import("@skeems/directus")).createDirectusAdapter,
  pocketbase: async () => (await import("@skeems/pocketbase")).createPocketBaseAdapter,
  nocodb: async () => (await import("@skeems/nocodb")).createNocoDbAdapter,
  strapi: async () => (await import("@skeems/strapi")).createStrapiAdapter,
  wikidata: async () => (await import("@skeems/wikidata")).createWikiDataAdapter,
  musicbrainz: async () => (await import("@skeems/musicbrainz")).createMusicBrainzAdapter,
  osm: async () => (await import("@skeems/osm")).createOsmAdapter,
  openlibrary: async () => (await import("@skeems/openlibrary")).createOpenLibraryAdapter,
  crossref: async () => (await import("@skeems/crossref")).createCrossRefAdapter,
  tmdb: async () => (await import("@skeems/tmdb")).createTmdbAdapter,
};

export function knownAdapters(): string[] {
  return Object.keys(REGISTRY);
}

/**
 * Default connection URLs for the read-tier reference adapters, so that
 * `--adapter wikidata` works with no `--url` (and `sources:` entries can omit
 * `connection.url`). Only the public reference services have a canonical
 * endpoint; the writable backends (directus/pocketbase/nocodb/strapi) are
 * deployment-specific, so a wrong guess is worse than the missing-URL error.
 * URLs mirror the adapter smoke scripts (`test/smoke/*.mjs`).
 */
const DEFAULT_URLS: Record<string, string> = {
  wikidata: "https://www.wikidata.org",
  musicbrainz: "https://musicbrainz.org",
  osm: "https://api.openstreetmap.org",
  openlibrary: "https://openlibrary.org",
  crossref: "https://api.crossref.org",
  tmdb: "https://api.themoviedb.org/3",
};

/** The canonical default URL for an adapter, or `undefined` if it has none. */
export function defaultAdapterUrl(name: string): string | undefined {
  return DEFAULT_URLS[name];
}

/**
 * Resolve, instantiate, and connect the adapter named by config. Throws a
 * UsageError for an unknown adapter name.
 */
export async function createAdapter(name: string, config: AdapterConfig): Promise<SkemAdapter> {
  const loader = REGISTRY[name];
  if (!loader) {
    throw new UsageError(`Unknown adapter "${name}". Known adapters: ${knownAdapters().join(", ")}.`);
  }
  const factory = await loader();
  const adapter = factory();
  await adapter.connect(config);
  return adapter;
}
