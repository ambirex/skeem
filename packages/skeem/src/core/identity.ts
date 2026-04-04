import type { Filter } from "../types/index.js";

const CORPORATE_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "l.l.c",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "limited",
]);

export function normalizeAlias(value: string): string {
  const lowered = value.toLowerCase();
  const withoutJoinedPunctuation = lowered
    .replace(/[.'’"]/g, "")
    .replace(/[-_/]+/g, " ")
    .replace(/[(),:;!?&]+/g, " ");
  const collapsed = withoutJoinedPunctuation.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return "";
  }

  const tokens = collapsed.split(" ");
  while (tokens.length > 1 && CORPORATE_SUFFIXES.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }

  return tokens.join(" ");
}

export function getAliasLookupCandidate(filter: Filter): { field: string; raw: string; normalized: string } | undefined {
  const entries = Object.entries(filter);
  if (entries.length !== 1) {
    return undefined;
  }

  const [field, value] = entries[0]!;
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = normalizeAlias(value);
  if (normalized.length === 0) {
    return undefined;
  }

  return {
    field,
    raw: value,
    normalized,
  };
}
