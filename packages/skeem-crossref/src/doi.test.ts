import { describe, expect, test } from "vitest";

import { encodeDoiPath, normalizeDoi, normalizeOrcid } from "./doi.js";

describe("normalizeDoi", () => {
  test("strips URL and doi: prefixes and lowercases", () => {
    expect(normalizeDoi("https://doi.org/10.1038/NATURE12373")).toBe("10.1038/nature12373");
    expect(normalizeDoi("http://dx.doi.org/10.1038/nature12373")).toBe("10.1038/nature12373");
    expect(normalizeDoi("doi:10.7554/eLife.02181")).toBe("10.7554/elife.02181");
    expect(normalizeDoi("10.7554/elife.02181")).toBe("10.7554/elife.02181");
  });

  test("rejects values that do not look like a DOI", () => {
    expect(() => normalizeDoi("not-a-doi")).toThrow(/not a valid DOI/i);
    expect(() => normalizeDoi("11.1234/x")).toThrow(/not a valid DOI/i);
  });
});

describe("encodeDoiPath", () => {
  test("keeps literal slashes but encodes hazardous characters (SICI DOIs)", () => {
    const sici = "10.1002/(sici)1097-4628(19960621)60:12<2069::aid-app6>3.0.co;2-5";
    const encoded = encodeDoiPath(sici);
    expect(encoded).toContain("10.1002/");
    expect(encoded).not.toContain("<");
    expect(encoded).not.toContain(">");
    expect(encoded.split("/").length).toBe(sici.split("/").length);
  });

  test("encodes # and ? so they cannot truncate the path", () => {
    expect(encodeDoiPath("10.1000/abc#frag")).toBe("10.1000/abc%23frag");
    expect(encodeDoiPath("10.1000/abc?x=1")).toBe("10.1000/abc%3Fx%3D1");
  });
});

describe("normalizeOrcid", () => {
  test("strips the URL prefix", () => {
    expect(normalizeOrcid("https://orcid.org/0000-0002-1641-3403")).toBe("0000-0002-1641-3403");
    expect(normalizeOrcid("0000-0002-1641-3403")).toBe("0000-0002-1641-3403");
  });
});
