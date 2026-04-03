import YAML from "yaml";

import { SkemError } from "../errors/index.js";
import type { ErrorEnvelope, SuccessEnvelope } from "../types/index.js";

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
    return YAML.stringify(envelope.data);
  }

  if (envelope.operation === "find" && Array.isArray(envelope.data)) {
    return envelope.data.length === 0
      ? `No records found in ${envelope.collection}.`
      : envelope.data.map((row) => JSON.stringify(row)).join("\n");
  }

  if (envelope.operation === "delete") {
    return `Deleted record from ${envelope.collection}.`;
  }

  return YAML.stringify(envelope.data ?? envelope);
}
