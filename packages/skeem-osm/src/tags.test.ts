import { describe, expect, test } from "vitest";

import { externalIdsFromTags } from "./tags.js";

describe("externalIdsFromTags", () => {
  test("extracts wikidata, wikipedia URL, and website", () => {
    expect(externalIdsFromTags({
      wikidata: "Q243",
      wikipedia: "fr:Tour Eiffel",
      website: "https://www.toureiffel.paris/",
      name: "Tour Eiffel",
    })).toEqual({
      wikidata: ["Q243"],
      wikipedia: ["https://fr.wikipedia.org/wiki/Tour_Eiffel"],
      official_website: ["https://www.toureiffel.paris/"],
    });
  });

  test("splits semicolon-separated wikidata values and normalizes case", () => {
    expect(externalIdsFromTags({ wikidata: "q1; Q2 ;Q2" }).wikidata).toEqual(["Q1", "Q2"]);
  });

  test("prefixed *:wikidata tags do NOT feed externalIds.wikidata", () => {
    const result = externalIdsFromTags({
      "brand:wikidata": "Q38076",
      "operator:wikidata": "Q123",
      "subject:wikidata": "Q456",
    });
    expect(result.wikidata).toBeUndefined();
  });

  test("contact:website is a fallback for website", () => {
    expect(externalIdsFromTags({ "contact:website": "https://example.org" }).official_website)
      .toEqual(["https://example.org"]);
  });

  test("malformed wikipedia tags are skipped", () => {
    expect(externalIdsFromTags({ wikipedia: "NoLanguagePrefix" })).toEqual({});
  });
});
