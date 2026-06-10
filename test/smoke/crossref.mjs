#!/usr/bin/env node
// Live smoke for the read-only CrossRef adapter. The fixture DOI
// (10.7554/elife.02181) was chosen because its CrossRef metadata carries both
// ORCIDs and funder DOIs — many records have neither.
import { createRunner, makeAssert, sleep } from "./live-lib.mjs";

const run = createRunner(["--adapter", "crossref", "--url", "https://api.crossref.org", "--json"]);
const assert = makeAssert("CrossRef");
const DOI = "10.7554/elife.02181";

const results = {};

const ls = run(["ls"]);
assert(ls.data.length === 1 && ls.data[0].collection === "works", "ls returns the works collection", ls);
results.ls = true;
await sleep(400);

const work = run(["get", "works", DOI]);
assert(work.data.id === DOI, "get returns the lowercase DOI as id", work);
assert(work.data.externalIds?.orcid?.length > 0, "externalIds carry ORCIDs", work);
assert(work.data.externalIds?.funder_doi?.length > 0, "externalIds carry funder DOIs", work);
results.get = true;
await sleep(400);

// Prefixed/uppercase DOI input normalizes to the same record.
const prefixed = run(["get", "works", `https://doi.org/10.7554/eLife.02181`]);
assert(prefixed.data.id === DOI, "URL-prefixed DOI input normalizes", prefixed);
results.normalize = true;
await sleep(400);

const orcid = work.data.externalIds.orcid[0];
const reverse = run(["find", "works", "--where", `orcid=${orcid}`, "--limit", "5"]);
assert(reverse.count > 0, "reverse pivot by ORCID returns works", reverse);
results.findByOrcid = true;
await sleep(400);

const search = run(["find", "works", "--where", "title=Attention Is All You Need", "--limit", "3"]);
assert(search.count > 0 && search.data.every((r) => typeof r.id === "string" && r.id.startsWith("10.")), "bibliographic search returns DOIs", search);
results.find = true;
await sleep(400);

const missing = run(["get", "works", "10.99999/does-not-exist-skeem"], { expectFailure: true });
assert(missing.ok === false && missing.error.code === "NOT_FOUND", "missing DOI is NOT_FOUND", missing);
results.notFound = true;

const create = run(["create", "works", "--title", "x"], { expectFailure: true });
assert(create.ok === false && /read-only/i.test(create.error.message), "create is rejected as read-only", create);
results.readOnly = true;

console.log(JSON.stringify({ ok: true, adapter: "crossref", results }, null, 2));
