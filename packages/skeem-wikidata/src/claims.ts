import type { WikibaseStatement } from "./types.js";

/**
 * Flatten Wikibase claims into `{ propertyId: [value, ...] }`, simplifying each
 * datavalue to a plain JS value. Entity references collapse to their id (e.g.
 * "Q5"), times to their ISO-ish string, quantities to their amount, etc. This is
 * lossy on purpose — the goal is a readable payload an agent can act on, not a
 * faithful RDF reproduction.
 */
export function simplifyClaims(
  claims: Record<string, WikibaseStatement[]> | undefined,
): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};
  if (!claims) return result;

  for (const [propertyId, statements] of Object.entries(claims)) {
    const values = statements
      .map((statement) => simplifyStatement(statement))
      .filter((value) => value !== undefined);
    if (values.length > 0) {
      result[propertyId] = values;
    }
  }
  return result;
}

function simplifyStatement(statement: WikibaseStatement): unknown {
  const snak = statement.mainsnak;
  if (!snak) return undefined;
  // "novalue" = asserted to have no value; "somevalue" = exists but unknown.
  if (snak.snaktype !== "value" || !snak.datavalue) {
    return null;
  }
  return simplifyDataValue(snak.datavalue);
}

function simplifyDataValue(datavalue: { value: unknown; type: string }): unknown {
  const value = datavalue.value as Record<string, unknown>;
  switch (datavalue.type) {
    case "wikibase-entityid":
      return value.id; // e.g. "Q5"
    case "time":
      return value.time; // e.g. "+1952-03-11T00:00:00Z"
    case "monolingualtext":
      return value.text;
    case "quantity":
      return value.amount; // e.g. "+1.96"
    case "globecoordinate":
      return { latitude: value.latitude, longitude: value.longitude };
    case "string":
      return datavalue.value;
    default:
      return datavalue.value;
  }
}
