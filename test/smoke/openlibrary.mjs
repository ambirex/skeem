#!/usr/bin/env node
// Live smoke for the read-only Open Library adapter.
import { createRunner, makeAssert, sleep } from "./live-lib.mjs";

const run = createRunner(["--adapter", "openlibrary", "--url", "https://openlibrary.org", "--json"]);
const assert = makeAssert("OpenLibrary");

const results = {};

const ls = run(["ls"]);
const names = ls.data.map((c) => c.collection).sort();
assert(names.join(",") === "authors,editions,works", "ls returns works/editions/authors", ls);
results.ls = true;
await sleep(400);

const douglas = run(["get", "authors", "OL272947A"]);
assert(douglas.data.name === "Douglas Adams", "get resolves Douglas Adams", douglas);
assert(douglas.data.externalIds?.wikidata?.includes("Q42"), "author externalIds carry the Wikidata Q-id", douglas);
assert(douglas.data.externalIds?.musicbrainz_artist?.length > 0, "author externalIds carry the MusicBrainz artist id", douglas);
results.getAuthor = true;
await sleep(400);

const edition = run(["find", "editions", "--where", "isbn=9780345391803"]);
assert(edition.count === 1 && edition.data[0].externalIds?.isbn_13?.includes("9780345391803"), "ISBN lookup resolves an edition", edition);
results.findEditionByIsbn = true;
await sleep(400);

const works = run(["find", "works", "--where", "title=The Hitchhiker's Guide to the Galaxy", "--limit", "5"]);
assert(works.count > 0 && works.data.every((r) => typeof r.id === "string" && r.id.startsWith("OL")), "works search returns bare OL ids", works);
results.findWorks = true;
await sleep(400);

const missing = run(["get", "authors", "OL999999999A"], { expectFailure: true });
assert(missing.ok === false && missing.error.code === "NOT_FOUND", "missing author is NOT_FOUND", missing);
results.notFound = true;
await sleep(400);

const create = run(["create", "works", "--title", "x"], { expectFailure: true });
assert(create.ok === false && /read-only/i.test(create.error.message), "create is rejected as read-only", create);
results.readOnly = true;

console.log(JSON.stringify({ ok: true, adapter: "openlibrary", results }, null, 2));
