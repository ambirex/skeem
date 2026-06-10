import { describe, expect, test } from "vitest";

import { normalizeIsbn, stripOlKey } from "./ids.js";

describe("stripOlKey", () => {
  test("strips works/books/authors prefixes and leaves bare ids alone", () => {
    expect(stripOlKey("/works/OL45883W")).toBe("OL45883W");
    expect(stripOlKey("/books/OL27297031M")).toBe("OL27297031M");
    expect(stripOlKey("/authors/OL272947A")).toBe("OL272947A");
    expect(stripOlKey("OL272947A")).toBe("OL272947A");
    expect(stripOlKey(undefined)).toBeNull();
  });
});

describe("normalizeIsbn", () => {
  test("strips hyphens/spaces and uppercases X", () => {
    expect(normalizeIsbn("0-345-39180-2")).toBe("0345391802");
    expect(normalizeIsbn("978 0345391803")).toBe("9780345391803");
    expect(normalizeIsbn("080442957x")).toBe("080442957X");
  });

  test("left-pads all-digit values the CLI coerced to numbers", () => {
    // --where isbn=0261103563 arrives as the number 261103563.
    expect(normalizeIsbn(261103563)).toBe("0261103563");
  });

  test("rejects values that are not 10 or 13 characters", () => {
    expect(() => normalizeIsbn("12345678901")).toThrow(/not a valid ISBN/i);
    expect(() => normalizeIsbn("abc")).toThrow(/not a valid ISBN/i);
  });
});
