#!/usr/bin/env node
// Live smoke for the read-only WikiData adapter. Hits the public WikiData API
// (no auth) and asserts get/find behavior plus the read-only guard. Network-
// dependent by nature; intended for `npm run smoke:wikidata` and an
// informational CI job rather than a hard gate.
import { createRunner, makeAssert } from "./live-lib.mjs";

const run = createRunner(["--adapter", "wikidata", "--url", "https://www.wikidata.org", "--json"]);
const assert = makeAssert("WikiData");

const results = {};

const ls = run(["ls"]);
const names = ls.data.map((c) => c.collection).sort();
assert(names.join(",") === "items,properties", "ls returns items + properties", ls);
results.ls = true;

const douglas = run(["get", "items", "Q42"]);
assert(douglas.data.label === "Douglas Adams", "get Q42 resolves Douglas Adams", douglas);
assert(Array.isArray(douglas.data.claims?.P31) && douglas.data.claims.P31.includes("Q5"), "Q42 is an instance of human (P31 -> Q5)", douglas);
assert(douglas.data.externalIds?.imdb?.includes("nm0010930"), "Q42 externalIds carry the IMDb id", douglas);
assert(douglas.data.externalIds?.musicbrainz_artist?.length > 0, "Q42 externalIds carry a MusicBrainz artist id", douglas);
results.get = true;

const reverse = run(["find", "items", "--where", "imdb=nm0010930"]);
assert(reverse.data.some((r) => r.id === "Q42"), "reverse lookup by IMDb id finds Q42", reverse);
results.reverseFind = true;

const ada = run(["find", "items", "--where", "label=Ada Lovelace"]);
assert(ada.count > 0 && ada.data.some((r) => r.id === "Q7259"), "find surfaces Ada Lovelace (Q7259)", ada);
results.find = true;

const prop = run(["find", "properties", "--where", "label=instance of"]);
assert(prop.data.some((r) => r.id === "P31"), "find properties surfaces P31", prop);
results.findProperties = true;

// A valid-format but nonexistent id returns NOT_FOUND (a malformed id like "Q0"
// is a VALIDATION error from the API instead).
const missing = run(["get", "items", "Q999999999"], { expectFailure: true });
assert(missing.ok === false && missing.error.code === "NOT_FOUND", "missing entity is NOT_FOUND", missing);
results.notFound = true;

const create = run(["create", "items", "--label", "x"], { expectFailure: true });
assert(create.ok === false && /read-only/i.test(create.error.message), "create is rejected as read-only", create);
results.readOnly = true;

console.log(JSON.stringify({ ok: true, adapter: "wikidata", results }, null, 2));
