import { describe, expect, test } from "vitest";

import { EXTERNAL_ID_KEYS, EXTERNAL_ID_PROPERTIES, partitionClaims, simplifyClaims } from "./claims.js";

function valueStatement(type: string, value: unknown, datatype?: string) {
  return {
    mainsnak: {
      snaktype: "value" as const,
      property: "P1",
      ...(datatype ? { datatype } : {}),
      datavalue: { type, value },
    },
  };
}

describe("simplifyClaims", () => {
  test("collapses each datavalue type to a plain value", () => {
    const claims = {
      P31: [valueStatement("wikibase-entityid", { "entity-type": "item", "numeric-id": 5, id: "Q5" })],
      P569: [valueStatement("time", { time: "+1952-03-11T00:00:00Z", precision: 11 })],
      P1442: [valueStatement("string", "gravestone.jpg")],
      P2048: [valueStatement("quantity", { amount: "+1.96", unit: "Q11573" })],
      P1813: [valueStatement("monolingualtext", { text: "Douglas Adams", language: "en" })],
      P625: [valueStatement("globecoordinate", { latitude: 51.5, longitude: -0.1 })],
    };

    expect(simplifyClaims(claims)).toEqual({
      P31: ["Q5"],
      P569: ["+1952-03-11T00:00:00Z"],
      P1442: ["gravestone.jpg"],
      P2048: ["+1.96"],
      P1813: ["Douglas Adams"],
      P625: [{ latitude: 51.5, longitude: -0.1 }],
    });
  });

  test("multiple statements for one property become an array", () => {
    const claims = {
      P106: [
        valueStatement("wikibase-entityid", { id: "Q36180" }),
        valueStatement("wikibase-entityid", { id: "Q214917" }),
      ],
    };
    expect(simplifyClaims(claims).P106).toEqual(["Q36180", "Q214917"]);
  });

  test("novalue / somevalue snaks become null", () => {
    const claims = {
      P1: [{ mainsnak: { snaktype: "novalue" as const, property: "P1" } }],
      P2: [{ mainsnak: { snaktype: "somevalue" as const, property: "P2" } }],
    };
    expect(simplifyClaims(claims)).toEqual({ P1: [null], P2: [null] });
  });

  test("undefined claims yield an empty object", () => {
    expect(simplifyClaims(undefined)).toEqual({});
  });
});

describe("partitionClaims", () => {
  test("splits external-id statements out of ordinary claims", () => {
    const claims = {
      P31: [valueStatement("wikibase-entityid", { id: "Q5" }, "wikibase-item")],
      P345: [valueStatement("string", "nm0010930", "external-id")],
      P434: [valueStatement("string", "e9ed318d-8cc5-4cf8-ab77-505e39ab6ea4", "external-id")],
    };
    const result = partitionClaims(claims);

    expect(result.claims).toEqual({ P31: ["Q5"] });
    expect(result.externalIds).toEqual({
      imdb: ["nm0010930"],
      musicbrainz_artist: ["e9ed318d-8cc5-4cf8-ab77-505e39ab6ea4"],
    });
  });

  test("uncurated external-id properties keep their P-id key", () => {
    const claims = {
      P9999: [valueStatement("string", "xyz", "external-id")],
    };
    expect(partitionClaims(claims).externalIds).toEqual({ P9999: ["xyz"] });
  });

  test("P856 (url datatype) maps to official_website", () => {
    const claims = {
      P856: [valueStatement("string", "https://douglasadams.com/", "url")],
    };
    const result = partitionClaims(claims);
    expect(result.externalIds).toEqual({ official_website: ["https://douglasadams.com/"] });
    expect(result.claims).toEqual({});
  });

  test("externalIds skip novalue snaks and dedupe; values are strings", () => {
    const claims = {
      P345: [
        valueStatement("string", "nm0010930", "external-id"),
        { mainsnak: { snaktype: "novalue" as const, property: "P345", datatype: "external-id" } },
        valueStatement("string", "nm0010930", "external-id"),
      ],
      P698: [valueStatement("string", 23193287 as unknown as string, "external-id")],
    };
    const result = partitionClaims(claims);
    expect(result.externalIds.P698 ?? result.externalIds.pubmed).toEqual(["23193287"]);
    expect(result.externalIds.imdb).toEqual(["nm0010930"]);
  });

  test("the curated map and its reverse stay in sync", () => {
    for (const [pid, key] of Object.entries(EXTERNAL_ID_PROPERTIES)) {
      expect(EXTERNAL_ID_KEYS[key]).toBe(pid);
    }
  });
});
