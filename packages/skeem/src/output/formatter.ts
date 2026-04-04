import YAML from "yaml";

import { SkemError } from "../errors/index.js";
import type { DescribeDocument, SchemaDocument } from "../schema/serialization.js";
import type { ErrorEnvelope, SchemaDiffResult, SchemaPlanEntry, SchemaPlanSummary, SuccessEnvelope } from "../types/index.js";

export function toSuccessEnvelope(partial: Omit<SuccessEnvelope, "ok">): SuccessEnvelope {
  return {
    ok: true,
    ...partial,
  };
}

export function toErrorEnvelope(error: unknown, operation?: string, collection?: string): ErrorEnvelope {
  if (error instanceof SkemError) {
    return {
      ok: false,
      ...(operation ? { operation } : {}),
      ...(collection ? { collection } : {}),
      error: {
        code: error.code,
        message: error.message,
        ...(typeof error.details?.field === "string" ? { field: error.details.field } : {}),
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }

  if (error instanceof Error) {
    return {
      ok: false,
      ...(operation ? { operation } : {}),
      ...(collection ? { collection } : {}),
      error: {
        code: "ERROR",
        message: error.message,
      },
    };
  }

  return {
    ok: false,
    ...(operation ? { operation } : {}),
    ...(collection ? { collection } : {}),
    error: {
      code: "ERROR",
      message: String(error),
    },
  };
}

export function writeEnvelope(envelope: SuccessEnvelope | ErrorEnvelope, options: { json: boolean }): void {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${renderHuman(envelope)}\n`);
}

function renderHuman(envelope: SuccessEnvelope | ErrorEnvelope): string {
  if (!envelope.ok) {
    return `Error [${envelope.error.code}]: ${envelope.error.message}`;
  }

  if (envelope.operation === "ls" && Array.isArray(envelope.data)) {
    return envelope.data
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        const name = String(row.collection);
        const fieldCount = String(row.fields ?? "");
        const count = row.count !== undefined ? `  ${row.count} records` : "";
        return `${name.padEnd(24)} ${fieldCount} fields${count}`;
      })
      .join("\n");
  }

  if (envelope.operation === "discover") {
    const discoverData = envelope.data as { path?: string; schema?: SchemaDocument } | SchemaDocument | undefined;
    if (discoverData && typeof discoverData === "object" && "path" in discoverData && typeof discoverData.path === "string") {
      return `Wrote schema to ${discoverData.path}`;
    }

    return YAML.stringify(discoverData);
  }

  if (envelope.operation === "describe" && envelope.data && typeof envelope.data === "object") {
    return renderDescribe(envelope.collection ?? "collection", envelope.data as DescribeDocument & { count?: number | null });
  }

  if (envelope.operation === "diff" && envelope.data && typeof envelope.data === "object") {
    return renderDiff(envelope.data as SchemaDiffResult);
  }

  if ((envelope.operation === "define" || (envelope.operation === "dry_run" && envelope.action === "define")) && Array.isArray(envelope.plan)) {
    return renderDefinePlan(
      envelope.operation,
      envelope.plan as SchemaPlanEntry[],
      envelope.data as { path?: string; summary?: SchemaPlanSummary } | undefined,
    );
  }

  if (envelope.operation === "find" && Array.isArray(envelope.data)) {
    return envelope.data.length === 0
      ? `No records found in ${envelope.collection}.`
      : envelope.data.map((row) => JSON.stringify(row)).join("\n");
  }

  if (envelope.operation === "delete") {
    return `Deleted record from ${envelope.collection}.`;
  }

  if (envelope.operation === "upsert") {
    const verb = envelope.action === "created" ? "Created" : "Updated";
    return `${verb} record in ${envelope.collection}.`;
  }

  if ((envelope.operation === "link" || envelope.operation === "unlink") && envelope.data && typeof envelope.data === "object") {
    const data = envelope.data as {
      source?: { collection?: string; id?: string | number };
      target?: { collection?: string; id?: string | number };
      relation?: { field?: string; type?: string } | string;
    };
    const relationField = typeof data.relation === "string" ? data.relation : data.relation?.field;
    const source = `${data.source?.collection ?? envelope.collection}#${data.source?.id ?? "?"}`;
    const target = `${data.target?.collection ?? "record"}#${data.target?.id ?? "?"}`;
    const status = envelope.action?.replace(/_/g, " ") ?? envelope.operation;
    return `${status}: ${source} ${relationField ? `${relationField} ` : ""}${envelope.operation === "link" ? "->" : "x"} ${target}`;
  }

  return YAML.stringify(envelope.data ?? envelope);
}

function renderDescribe(collectionName: string, describe: DescribeDocument & { count?: number | null }): string {
  const fields = describe.fields.length === 0
    ? "  Fields:\n    (none)"
    : [
        "  Fields:",
        ...describe.fields.map((field) => {
          const qualifiers = [
            field.name === describe.primaryKey ? "PK" : undefined,
            field.required ? "required" : undefined,
            field.unique ? "unique" : undefined,
            field.default !== undefined ? `default=${JSON.stringify(field.default)}` : undefined,
          ].filter(Boolean);
          return `    ${field.name.padEnd(18)} ${field.type}${qualifiers.length > 0 ? `  ${qualifiers.join(", ")}` : ""}`;
        }),
      ].join("\n");

  const relations = describe.relations.length === 0
    ? "  Relations:\n    (none)"
    : [
        "  Relations:",
        ...describe.relations.map((relation) => {
          const via = relation.junctionCollection ? ` via ${relation.junctionCollection}` : "";
          return `    ${relation.field.padEnd(18)} -> ${relation.relatedCollection}.${relation.relatedField} (${relation.type})${via}`;
        }),
      ].join("\n");

  const uniqueConstraints = describe.uniqueConstraints.length === 0
    ? "  Unique constraints:\n    (none)"
    : [
        "  Unique constraints:",
        ...describe.uniqueConstraints.map((constraint) => `    (${constraint.fields.join(", ")})`),
      ].join("\n");

  return [
    collectionName,
    fields,
    relations,
    uniqueConstraints,
    ...(describe.count !== undefined ? [`  Records: ${describe.count ?? "unknown"}`] : []),
  ].join("\n");
}

function renderDiff(diff: SchemaDiffResult): string {
  const directionDescription = diff.direction === "define" ? "file is truth" : "live is truth";
  const lines = [
    `Comparing ${diff.path ?? "schema document"} against live backend...`,
    `Direction: ${diff.direction} (${directionDescription})`,
  ];

  if (diff.changes.length === 0) {
    lines.push("  No schema differences found.");
  } else {
    lines.push(...diff.changes.map((change) => `  ${symbolFor(change.status)} ${change.message}`));
  }

  if (diff.matches.length > 0) {
    lines.push(...diff.matches.map((match) => `  = ${match}`));
  }

  lines.push(
    `Summary: ${diff.summary.totalChanges} changes, ${diff.summary.matches} matches`,
  );
  return lines.join("\n");
}

function symbolFor(status: "only_in_file" | "only_in_live" | "mismatch"): "+" | "-" | "~" {
  switch (status) {
    case "only_in_live":
      return "+";
    case "only_in_file":
      return "-";
    case "mismatch":
      return "~";
  }
}

function renderDefinePlan(
  operation: string,
  plan: SchemaPlanEntry[],
  data?: { path?: string; summary?: SchemaPlanSummary },
): string {
  const lines = [
    `${operation === "dry_run" ? "Plan" : "Applied"}: ${data?.path ?? "schema document"}`,
  ];

  if (plan.length === 0) {
    lines.push("  No schema changes required.");
  } else {
    lines.push(...plan.map((entry, index) => {
      const prefix = entry.status === "applied"
        ? "  ="
        : entry.status === "skipped"
          ? "  !"
          : "  ";
      const suffix = entry.reason ? ` [${entry.reason}]` : "";
      return `${prefix} ${index + 1}. ${entry.summary}${suffix}`;
    }));
  }

  if (data?.summary) {
    lines.push(
      `Summary: ${data.summary.total} actions, ${data.summary.applied} applied, ${data.summary.skipped} skipped, ${data.summary.blocked} blocked`,
    );
  }

  return lines.join("\n");
}
