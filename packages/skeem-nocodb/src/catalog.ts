import type { NocoDbClient } from "./client.js";
import type { NocoColumn, NocoListResponse, NocoTable } from "./types.js";

export interface CatalogColumn {
  id: string;
  title: string;
  uidt: string;
  pk: boolean;
  required: boolean;
  unique: boolean;
  system: boolean;
  options: NocoColumn["colOptions"];
}

export interface CatalogTable {
  id: string;
  title: string;
  /** The title of the primary-key column (NocoDB defaults to "Id"). */
  primaryKeyTitle: string;
  columns: CatalogColumn[];
  /** Link columns keyed by their title, for relation introspection + linking. */
  links: Map<string, { columnId: string; relatedTableId: string; type: string }>;
}

/**
 * NocoDB addresses tables and columns by id; skeem's contract is name-based.
 * The catalog fetches the base's tables once (with their columns) and resolves
 * collection/field names onto ids. It is invalidated after every schema
 * mutation so the next read reflects the change.
 */
export class NocoCatalog {
  private byTitle = new Map<string, CatalogTable>();
  private byId = new Map<string, CatalogTable>();
  private loaded = false;

  constructor(private readonly client: NocoDbClient, private readonly baseId: string) {}

  invalidate(): void {
    this.loaded = false;
    this.byTitle.clear();
    this.byId.clear();
  }

  async ensure(): Promise<void> {
    if (this.loaded) {
      return;
    }

    const tablesResponse = await this.client.get<NocoListResponse<NocoTable>>(
      `/api/v2/meta/bases/${this.baseId}/tables`,
    );
    const tables = tablesResponse.list ?? [];

    // First pass: register ids + titles so relation targets resolve by id.
    const detailed: NocoTable[] = [];
    for (const table of tables) {
      const full = await this.client.get<NocoTable>(`/api/v2/meta/tables/${table.id}`);
      detailed.push(full);
    }

    for (const table of detailed) {
      const columns = table.columns ?? [];
      const pkColumn = columns.find((c) => c.pk) ?? columns.find((c) => c.title === "Id");

      const catalogColumns: CatalogColumn[] = columns.map((c) => ({
        id: c.id,
        title: c.title,
        uidt: c.uidt,
        pk: Boolean(c.pk),
        required: Boolean(c.rqd),
        unique: Boolean(c.unique),
        system: Boolean(c.system),
        options: c.colOptions ?? null,
      }));

      const links = new Map<string, { columnId: string; relatedTableId: string; type: string }>();
      for (const c of columns) {
        if ((c.uidt === "LinkToAnotherRecord" || c.uidt === "Links") && c.colOptions?.fk_related_model_id) {
          links.set(c.title, {
            columnId: c.id,
            relatedTableId: c.colOptions.fk_related_model_id,
            type: c.colOptions.type ?? "bt",
          });
        }
      }

      const entry: CatalogTable = {
        id: table.id,
        title: table.title,
        primaryKeyTitle: pkColumn?.title ?? "Id",
        columns: catalogColumns,
        links,
      };
      this.byTitle.set(table.title, entry);
      this.byId.set(table.id, entry);
    }

    this.loaded = true;
  }

  tables(): CatalogTable[] {
    return Array.from(this.byTitle.values());
  }

  tableByTitle(title: string): CatalogTable | undefined {
    return this.byTitle.get(title);
  }

  tableById(id: string): CatalogTable | undefined {
    return this.byId.get(id);
  }

  /** Resolve a collection name to its table id, or throw a clear error. */
  requireTableId(title: string): string {
    const table = this.byTitle.get(title);
    if (!table) {
      throw new Error(`NocoDB has no table named "${title}".`);
    }
    return table.id;
  }
}
