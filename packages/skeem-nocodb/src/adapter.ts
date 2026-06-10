import { AdapterError } from "@skeems/types";
import type { SkemAdapter } from "@skeems/types";
import { NocoDbClient } from "./client.js";
import { NocoCatalog, type CatalogTable } from "./catalog.js";
import type {
  AdapterConfig,
  Collection,
  Field,
  FieldType,
  FindOptions,
  GetOptions,
  NocoListResponse,
  Relation,
  Schema,
  SchemaCollectionInput,
  SchemaFieldInput,
  SchemaRelationInput,
} from "./types.js";

const CANONICAL_PK = "id";

// NocoDB uidts that are managed by the platform, not the user. Skipping them on
// introspect keeps a freshly-defined collection from showing them as drift.
const SYSTEM_UIDTS = new Set(["CreatedTime", "LastModifiedTime", "CreatedBy", "LastModifiedBy", "Order"]);
// Virtual / computed columns skeem does not model.
const VIRTUAL_UIDTS = new Set(["Formula", "Rollup", "Lookup", "QrCode", "Barcode", "Button"]);
const LINK_UIDTS = new Set(["LinkToAnotherRecord", "Links"]);

export function createNocoDbAdapter(): SkemAdapter {
  const client = new NocoDbClient();
  let catalog: NocoCatalog | undefined;
  let baseId: string | undefined;

  function requireCatalog(): NocoCatalog {
    if (!catalog) {
      throw new Error("NocoDB adapter has not been connected.");
    }
    return catalog;
  }

  async function table(collection: string): Promise<CatalogTable> {
    const cat = requireCatalog();
    await cat.ensure();
    const entry = cat.tableByTitle(collection);
    if (!entry) {
      throw new AdapterError(`NocoDB has no table named "${collection}".`, {
        kind: "not_found",
        collectionMissing: true,
      });
    }
    return entry;
  }

  return {
    name: "nocodb",

    async connect(config: AdapterConfig) {
      client.connect(config);
      baseId = await resolveBaseId(client, config);
      catalog = new NocoCatalog(client, baseId);
    },

    async introspect(): Promise<Schema> {
      const cat = requireCatalog();
      await cat.ensure();
      const collections = new Map<string, Collection>();

      for (const t of cat.tables()) {
        const fields = new Map<string, Field>();
        const uniqueConstraints: { fields: string[] }[] = [];

        for (const col of t.columns) {
          if (col.pk || col.system || SYSTEM_UIDTS.has(col.uidt) || VIRTUAL_UIDTS.has(col.uidt) || LINK_UIDTS.has(col.uidt)) {
            continue;
          }
          const enumValues = (col.uidt === "SingleSelect" && col.options?.options)
            ? col.options.options.map((o) => o.title)
            : undefined;
          const field: Field = {
            name: col.title,
            type: mapUidtToFieldType(col.uidt),
            required: col.required,
            unique: col.unique,
            ...(enumValues && enumValues.length > 0 ? { enum: enumValues } : {}),
          };
          fields.set(field.name, field);
          if (col.unique) {
            uniqueConstraints.push({ fields: [col.title] });
          }
        }

        const relations: Relation[] = [];
        for (const [title, link] of t.links) {
          const related = cat.tableById(link.relatedTableId);
          if (!related) continue;
          relations.push({
            type: mapLinkType(link.type),
            field: title,
            relatedCollection: related.title,
            relatedField: CANONICAL_PK,
          });
        }

        collections.set(t.title, {
          name: t.title,
          primaryKey: CANONICAL_PK,
          fields,
          relations,
          uniqueConstraints,
        });
      }

      return { collections };
    },

    async get(collection: string, id: string | number, _options?: GetOptions): Promise<Record<string, unknown>> {
      const t = await table(collection);
      const record = await client.get<Record<string, unknown>>(
        `/api/v2/tables/${t.id}/records/${encodeURIComponent(String(id))}`,
      );
      return mapRecordOut(t, record);
    },

    async find(
      collection: string,
      filter: Record<string, string | number | boolean | null>,
      options?: FindOptions,
    ): Promise<Record<string, unknown>[]> {
      const t = await table(collection);
      const query: Record<string, unknown> = {
        limit: options?.limit ?? 200,
        offset: options?.offset ?? 0,
      };
      const where = buildWhere(t, filter);
      if (where) query.where = where;
      if (options?.sort) query.sort = mapSortField(t, options.sort);

      const response = await client.get<NocoListResponse<Record<string, unknown>>>(
        `/api/v2/tables/${t.id}/records`,
        query,
      );
      return (response.list ?? []).map((row) => mapRecordOut(t, row));
    },

    async create(collection: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
      const t = await table(collection);
      const created = await client.post<Record<string, unknown>>(
        `/api/v2/tables/${t.id}/records`,
        mapDataIn(t, data),
      );
      const pk = extractPk(t, created);
      // NocoDB v2 may return only the primary key; re-read for the full record.
      if (pk !== undefined) {
        const full = await client.get<Record<string, unknown>>(
          `/api/v2/tables/${t.id}/records/${encodeURIComponent(String(pk))}`,
        );
        return mapRecordOut(t, full);
      }
      return mapRecordOut(t, created);
    },

    async update(collection: string, id: string | number, data: Record<string, unknown>): Promise<Record<string, unknown>> {
      const t = await table(collection);
      await client.patch(`/api/v2/tables/${t.id}/records`, {
        [t.primaryKeyTitle]: id,
        ...mapDataIn(t, data),
      });
      const full = await client.get<Record<string, unknown>>(
        `/api/v2/tables/${t.id}/records/${encodeURIComponent(String(id))}`,
      );
      return mapRecordOut(t, full);
    },

    async delete(collection: string, id: string | number): Promise<void> {
      const t = await table(collection);
      await client.delete(`/api/v2/tables/${t.id}/records`, { [t.primaryKeyTitle]: id });
    },

    async count(collection: string): Promise<number | null> {
      const t = await table(collection);
      const response = await client.get<NocoListResponse<unknown>>(
        `/api/v2/tables/${t.id}/records`,
        { limit: 1 },
      );
      return response.pageInfo?.totalRows ?? null;
    },

    async createCollection(input: SchemaCollectionInput): Promise<void> {
      await client.post(`/api/v2/meta/bases/${baseId}/tables`, {
        title: input.name,
        columns: input.fields.map(toNocoColumn),
      });
      requireCatalog().invalidate();
    },

    async deleteCollection(collection: string): Promise<void> {
      const t = await table(collection);
      await client.delete(`/api/v2/meta/tables/${t.id}`);
      requireCatalog().invalidate();
    },

    async createField(collection: string, field: SchemaFieldInput): Promise<void> {
      const t = await table(collection);
      await client.post(`/api/v2/meta/tables/${t.id}/columns`, toNocoColumn(field));
      requireCatalog().invalidate();
    },

    async updateField(collection: string, fieldName: string, field: SchemaFieldInput): Promise<void> {
      const t = await table(collection);
      const column = t.columns.find((c) => c.title === fieldName);
      if (!column) {
        throw new AdapterError(`Field "${fieldName}" not found on "${collection}".`, { kind: "not_found" });
      }
      await client.patch(`/api/v2/meta/columns/${column.id}`, { ...toNocoColumn(field), column_name: undefined });
      requireCatalog().invalidate();
    },

    async deleteField(collection: string, fieldName: string): Promise<void> {
      const t = await table(collection);
      const column = t.columns.find((c) => c.title === fieldName);
      if (!column) {
        throw new AdapterError(`Field "${fieldName}" not found on "${collection}".`, { kind: "not_found" });
      }
      await client.delete(`/api/v2/meta/columns/${column.id}`);
      requireCatalog().invalidate();
    },

    async createRelation(input: SchemaRelationInput): Promise<void> {
      const t = await table(input.collection);
      const related = await table(input.relatedCollection);
      await client.post(`/api/v2/meta/tables/${t.id}/columns`, {
        title: input.field,
        uidt: "LinkToAnotherRecord",
        colOptions: {
          type: input.type === "m2m" ? "mm" : "bt",
          fk_related_model_id: related.id,
        },
      });
      requireCatalog().invalidate();
    },

    async updateRelation(from: SchemaRelationInput, to: SchemaRelationInput): Promise<void> {
      await this.deleteRelation!(from);
      await this.createRelation!(to);
    },

    async deleteRelation(input: SchemaRelationInput): Promise<void> {
      const t = await table(input.collection);
      const link = t.links.get(input.field);
      if (!link) {
        throw new AdapterError(`Relation "${input.field}" not found on "${input.collection}".`, { kind: "not_found" });
      }
      await client.delete(`/api/v2/meta/columns/${link.columnId}`);
      requireCatalog().invalidate();
    },
  } satisfies SkemAdapter;
}

async function resolveBaseId(client: NocoDbClient, config: AdapterConfig): Promise<string> {
  const explicit = config["base"] ?? config["baseId"];
  if (typeof explicit === "string" && explicit.length > 0) {
    return explicit;
  }
  // Auto-discover when the instance hosts exactly one base.
  const response = await client.get<NocoListResponse<{ id: string; title?: string }>>("/api/v2/meta/bases");
  const bases = response.list ?? [];
  if (bases.length === 1) {
    return bases[0]!.id;
  }
  if (bases.length === 0) {
    throw new AdapterError("NocoDB returned no bases; set connection.base to a base id.", { kind: "validation" });
  }
  throw new AdapterError(
    `NocoDB has multiple bases (${bases.map((b) => b.title ?? b.id).join(", ")}); set connection.base to one of their ids.`,
    { kind: "validation" },
  );
}

function mapRecordOut(t: CatalogTable, record: Record<string, unknown>): Record<string, unknown> {
  if (t.primaryKeyTitle === CANONICAL_PK || !(t.primaryKeyTitle in record)) {
    return record;
  }
  const { [t.primaryKeyTitle]: pkValue, ...rest } = record;
  return { [CANONICAL_PK]: pkValue, ...rest };
}

function mapDataIn(t: CatalogTable, data: Record<string, unknown>): Record<string, unknown> {
  if (t.primaryKeyTitle === CANONICAL_PK || !(CANONICAL_PK in data)) {
    return data;
  }
  const { [CANONICAL_PK]: idValue, ...rest } = data;
  return { [t.primaryKeyTitle]: idValue, ...rest };
}

function extractPk(t: CatalogTable, record: Record<string, unknown>): unknown {
  return record[t.primaryKeyTitle] ?? record.Id ?? record.id;
}

function buildWhere(t: CatalogTable, filter: Record<string, string | number | boolean | null>): string | undefined {
  const clauses = Object.entries(filter).map(([field, value]) => {
    const column = field === CANONICAL_PK ? t.primaryKeyTitle : field;
    if (value === null) {
      return `(${column},is,null)`;
    }
    return `(${column},eq,${value})`;
  });
  return clauses.length ? clauses.join("~and") : undefined;
}

function mapSortField(t: CatalogTable, sort: string): string {
  // skeem sort is a single field, optionally "-" prefixed for descending.
  if (sort.startsWith("-")) {
    const field = sort.slice(1);
    return `-${field === CANONICAL_PK ? t.primaryKeyTitle : field}`;
  }
  return sort === CANONICAL_PK ? t.primaryKeyTitle : sort;
}

function mapUidtToFieldType(uidt: string): FieldType {
  switch (uidt) {
    case "LongText":
      return "text";
    case "Number":
    case "Year":
    case "AutoNumber":
      return "integer";
    case "Decimal":
    case "Currency":
    case "Percent":
    case "Rating":
    case "Duration":
      return "float";
    case "Checkbox":
      return "boolean";
    case "Date":
      return "date";
    case "DateTime":
      return "datetime";
    case "MultiSelect":
      return "csv";
    case "JSON":
    case "Attachment":
      return "json";
    case "SingleLineText":
    case "SingleSelect":
    case "Email":
    case "URL":
    case "PhoneNumber":
    default:
      return "string";
  }
}

function mapLinkType(nocoType: string): Relation["type"] {
  switch (nocoType) {
    case "mm":
      return "m2m";
    case "hm":
      return "o2m";
    case "bt":
    case "oo":
    default:
      return "m2o";
  }
}

function toNocoColumn(field: SchemaFieldInput): Record<string, unknown> {
  const hasEnum = Array.isArray(field.enum) && field.enum.length > 0;
  return {
    title: field.name,
    uidt: hasEnum ? "SingleSelect" : mapFieldTypeToUidt(field.type),
    ...(field.required ? { rqd: true } : {}),
    ...(field.unique ? { unique: true } : {}),
    ...(hasEnum ? { colOptions: { options: field.enum!.map((value) => ({ title: value })) } } : {}),
  };
}

function mapFieldTypeToUidt(type: FieldType): string {
  switch (type) {
    case "text":
      return "LongText";
    case "integer":
      return "Number";
    case "float":
      return "Decimal";
    case "boolean":
      return "Checkbox";
    case "date":
      return "Date";
    case "datetime":
      return "DateTime";
    case "json":
      return "JSON";
    case "uuid":
    case "csv":
    case "string":
    default:
      return "SingleLineText";
  }
}
