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
};

export function knownAdapters(): string[] {
  return Object.keys(REGISTRY);
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
