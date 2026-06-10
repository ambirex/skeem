import { AdapterError } from "@skeems/types";

/** Strip an Open Library path prefix: "/works/OL45883W" -> "OL45883W". */
export function stripOlKey(key: string | undefined): string | null {
  if (!key) return null;
  return key.replace(/^\/(works|books|authors)\//, "");
}

/**
 * Normalize an ISBN per the shared external-ids contract: strip hyphens and
 * spaces, uppercase a trailing X, and left-pad all-digit values shorter than
 * ten back to ISBN-10 length — the CLI's scalar coercion turns `0261103563`
 * into the number 261103563, eating the leading zero that most pre-2007 ISBNs
 * have. Anything that isn't 10 or 13 characters after cleanup is rejected.
 */
export function normalizeIsbn(raw: string | number | boolean): string {
  let value = String(raw).replace(/[-\s]/g, "").toUpperCase();
  if (/^\d{1,9}$/.test(value)) {
    value = value.padStart(10, "0");
  }
  if (!/^(\d{9}[\dX]|\d{13})$/.test(value)) {
    throw new AdapterError(
      `"${raw}" is not a valid ISBN-10 or ISBN-13.`,
      { kind: "validation", field: "isbn" },
    );
  }
  return value;
}
