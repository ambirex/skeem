import { describe, expect, test } from "vitest";

import { simplifyClaims } from "./claims.js";

function valueStatement(type: string, value: unknown) {
  return { mainsnak: { snaktype: "value" as const, property: "P1", datavalue: { type, value } } };
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
