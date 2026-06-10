import type { Collection, Field, Relation } from "../types/index.js";

export type ToolFormat = "openai" | "anthropic";

export interface GenerateToolsOptions {
  format: ToolFormat;
  /** Include schema-management tools (discover/define). */
  includeSchema?: boolean;
}

type JsonSchema = Record<string, unknown>;
type ToolDefinition = Record<string, unknown>;

/**
 * Generate LLM tool definitions from a set of collections (spec Part VI §27).
 * Each collection yields create/find/get/update/delete tools; relation params
 * document the `?`/`??` resolution grammar. The result is wrapped for the
 * requested provider format.
 */
export function generateToolDefinitions(
  collections: Collection[],
  options: GenerateToolsOptions,
): ToolDefinition[] {
  const tools: Array<{ name: string; description: string; parameters: JsonSchema }> = [];

  for (const collection of collections) {
    const fields = Array.from(collection.fields.values()).filter((f) => f.name !== collection.primaryKey);
    const m2oRelations = collection.relations.filter((r) => r.type === "m2o");
    const fieldSummary = summarizeFields(fields);
    const relationSummary = summarizeRelations(collection.relations);
    const summarySuffix = `${fieldSummary ? ` Fields: ${fieldSummary}.` : ""}${relationSummary ? ` Relations: ${relationSummary}.` : ""}`;

    tools.push({
      name: `skeem_create_${collection.name}`,
      description: `Create a new record in the ${collection.name} collection.${summarySuffix}`,
      parameters: objectSchema(
        {
          ...writableProperties(fields, m2oRelations),
        },
        fields.filter((f) => f.required).map((f) => f.name),
      ),
    });

    tools.push({
      name: `skeem_find_${collection.name}`,
      description: `Find records in the ${collection.name} collection by field equality.`,
      parameters: objectSchema(
        {
          ...Object.fromEntries(fields.map((f) => [f.name, filterProperty(f)])),
          limit: { type: "integer", description: "Maximum number of records to return." },
          offset: { type: "integer", description: "Number of records to skip." },
        },
        [],
      ),
    });

    tools.push({
      name: `skeem_get_${collection.name}`,
      description: `Get a single ${collection.name} record by id.`,
      parameters: objectSchema(
        {
          id: { type: ["string", "integer"], description: "The record's primary key." },
          expand: { type: "array", items: { type: "string" }, description: "Relation fields to expand (one level)." },
        },
        ["id"],
      ),
    });

    tools.push({
      name: `skeem_update_${collection.name}`,
      description: `Update fields on a ${collection.name} record by id.${summarySuffix}`,
      parameters: objectSchema(
        {
          id: { type: ["string", "integer"], description: "The record's primary key." },
          ...writableProperties(fields, m2oRelations),
        },
        ["id"],
      ),
    });

    tools.push({
      name: `skeem_delete_${collection.name}`,
      description: `Delete a ${collection.name} record by id (soft delete to trash unless hard is true).`,
      parameters: objectSchema(
        {
          id: { type: ["string", "integer"], description: "The record's primary key." },
          hard: { type: "boolean", description: "Permanently delete instead of moving to trash." },
        },
        ["id"],
      ),
    });
  }

  if (options.includeSchema) {
    tools.push({
      name: "skeem_discover",
      description: "Discover the live backend schema as a skeem schema document (collections, fields, relations).",
      parameters: objectSchema(
        { collections: { type: "array", items: { type: "string" }, description: "Limit discovery to these collections." } },
        [],
      ),
    });
    tools.push({
      name: "skeem_define",
      description: "Apply a skeem schema document to create or alter collections and fields. Use skeem_discover first to see the current shape.",
      parameters: objectSchema(
        {
          schema: { type: "object", description: "A skeem schema document ({ collections: { ... } })." },
          dry_run: { type: "boolean", description: "Preview the plan without applying it." },
        },
        ["schema"],
      ),
    });
  }

  return tools.map((tool) => wrapForFormat(tool, options.format));
}

function writableProperties(fields: Field[], m2oRelations: Relation[]): Record<string, JsonSchema> {
  const properties: Record<string, JsonSchema> = {};
  for (const field of fields) {
    properties[field.name] = fieldProperty(field);
  }
  for (const relation of m2oRelations) {
    // A scalar FK field may already cover the relation; the relation entry adds
    // the resolution grammar. Don't clobber an existing field of the same name.
    if (!properties[relation.field]) {
      properties[relation.field] = relationProperty(relation);
    }
  }
  return properties;
}

function fieldProperty(field: Field): JsonSchema {
  const schema: JsonSchema = { ...jsonType(field) };
  const notes: string[] = [];
  if (field.required) notes.push("required");
  if (field.unique) notes.push("unique");
  if (notes.length > 0) {
    schema.description = capitalize(notes.join(", "));
  }
  return schema;
}

function filterProperty(field: Field): JsonSchema {
  const schema: JsonSchema = { ...jsonType(field) };
  schema.description = `Filter ${field.name} by equality.`;
  return schema;
}

function relationProperty(relation: Relation): JsonSchema {
  return {
    type: ["string", "integer"],
    description:
      `Relation to ${relation.relatedCollection} (${relation.type}). ` +
      `Pass the related record's id, or "?field=value" to resolve an existing record, ` +
      `or "??field=value" to resolve-or-create.`,
  };
}

function jsonType(field: Field): JsonSchema {
  if (field.enum && field.enum.length > 0) {
    return { type: "string", enum: [...field.enum] };
  }
  switch (field.type) {
    case "integer":
      return { type: "integer" };
    case "float":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "date":
      return { type: "string", format: "date" };
    case "datetime":
      return { type: "string", format: "date-time" };
    case "json":
      return { type: "object" };
    case "csv":
      return { type: "array", items: { type: "string" } };
    case "string":
    case "text":
    case "uuid":
    default:
      return { type: "string" };
  }
}

function objectSchema(properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function wrapForFormat(
  tool: { name: string; description: string; parameters: JsonSchema },
  format: ToolFormat,
): ToolDefinition {
  if (format === "anthropic") {
    return { name: tool.name, description: tool.description, input_schema: tool.parameters };
  }
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

function summarizeFields(fields: Field[]): string {
  return fields
    .map((f) => {
      const flags = [f.required ? "required" : undefined, f.unique ? "unique" : undefined].filter(Boolean);
      const enumNote = f.enum && f.enum.length > 0 ? `, one of: ${f.enum.join("|")}` : "";
      return `${f.name} (${f.type}${flags.length > 0 ? `, ${flags.join(", ")}` : ""}${enumNote})`;
    })
    .join(", ");
}

function summarizeRelations(relations: Relation[]): string {
  return relations.map((r) => `${r.field} (${r.type} -> ${r.relatedCollection})`).join(", ");
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}
