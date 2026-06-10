#!/usr/bin/env node
// Live smoke for the read-only OpenStreetMap adapter. Paces itself across CLI
// processes (OSM API + Nominatim both expect ~1 req/s).
import { createRunner, makeAssert, sleep } from "./live-lib.mjs";

const run = createRunner(["--adapter", "osm", "--url", "https://api.openstreetmap.org", "--json"]);
const assert = makeAssert("OSM");

const results = {};

const ls = run(["ls"]);
assert(ls.data.length === 1 && ls.data[0].collection === "elements", "ls returns the elements collection", ls);
results.ls = true;
await sleep(1100);

const eiffel = run(["get", "elements", "way/5013364"]);
assert(eiffel.data.name === "Tour Eiffel", "get resolves the Eiffel Tower way", eiffel);
assert(eiffel.data.externalIds?.wikidata?.includes("Q243"), "externalIds carry the Wikidata Q-id from the bare tag", eiffel);
results.get = true;
await sleep(1100);

const found = run(["find", "elements", "--where", "name=Eiffel Tower", "--limit", "5"]);
assert(found.data.some((r) => r.id === "way/5013364"), "Nominatim find surfaces way/5013364", found);
results.find = true;
await sleep(1100);

const badId = run(["get", "elements", "5013364"], { expectFailure: true });
assert(badId.ok === false && /<type>\/<id>/.test(badId.error.message), "unprefixed ids are a validation error", badId);
results.idFormat = true;

const missing = run(["get", "elements", "node/999999999999"], { expectFailure: true });
assert(missing.ok === false && missing.error.code === "NOT_FOUND", "missing element is NOT_FOUND", missing);
results.notFound = true;
await sleep(1100);

const create = run(["create", "elements", "--name", "x"], { expectFailure: true });
assert(create.ok === false && /read-only/i.test(create.error.message), "create is rejected as read-only", create);
results.readOnly = true;

console.log(JSON.stringify({ ok: true, adapter: "osm", results }, null, 2));
