#!/usr/bin/env node
// Live smoke for the read-only MusicBrainz adapter. Each CLI run is its own
// process, so the script paces itself to respect the ~1 req/s etiquette.
import { createRunner, makeAssert, sleep } from "./live-lib.mjs";

const run = createRunner(["--adapter", "musicbrainz", "--url", "https://musicbrainz.org", "--json"]);
const assert = makeAssert("MusicBrainz");
const NIRVANA = "5b11f4ce-a62d-471e-81fc-a69a8278c7da";

const results = {};

const ls = run(["ls"]);
assert(ls.data.length === 6 && ls.data.some((c) => c.collection === "artists"), "ls returns the six entity collections", ls);
results.ls = true;
await sleep(1100);

const nirvana = run(["get", "artists", NIRVANA]);
assert(nirvana.data.name === "Nirvana", "get resolves Nirvana", nirvana);
assert(nirvana.data.externalIds?.wikidata?.includes("Q11649"), "externalIds carry the Wikidata Q-id", nirvana);
assert(Object.keys(nirvana.data.links ?? {}).length > 0, "un-normalized rel types ride along under links", nirvana);
results.get = true;
await sleep(1100);

const found = run(["find", "artists", "--where", "name=Nirvana", "--limit", "5"]);
assert(found.data.some((r) => r.id === NIRVANA), "find by name surfaces the Nirvana MBID", found);
results.find = true;
await sleep(1100);

// The nil UUID is rejected as 400 "Invalid mbid"; use a well-formed v4 that
// doesn't exist to exercise the NOT_FOUND path.
const missing = run(["get", "artists", "ffffffff-ffff-4fff-8fff-ffffffffffff"], { expectFailure: true });
assert(missing.ok === false && missing.error.code === "NOT_FOUND", "missing MBID is NOT_FOUND", missing);
results.notFound = true;
await sleep(1100);

const create = run(["create", "artists", "--name", "x"], { expectFailure: true });
assert(create.ok === false && /read-only/i.test(create.error.message), "create is rejected as read-only", create);
results.readOnly = true;

console.log(JSON.stringify({ ok: true, adapter: "musicbrainz", results }, null, 2));
