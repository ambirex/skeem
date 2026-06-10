#!/usr/bin/env node
// Live smoke for the read-only TMDB adapter. TMDB is the only read-tier source
// requiring auth: provide TMDB_API_KEY (a v4 Read Access Token or v3 key).
// Without it the smoke self-skips with exit 0 — safe locally and in CI, where
// the secrets context cannot gate a job directly.
import { createRunner, makeAssert, sleep } from "./live-lib.mjs";

const token = process.env.TMDB_API_KEY ?? "";
if (!token) {
  console.log(JSON.stringify({ ok: true, adapter: "tmdb", skipped: true, reason: "TMDB_API_KEY not set" }, null, 2));
  process.exit(0);
}

const run = createRunner(["--adapter", "tmdb", "--url", "https://api.themoviedb.org/3", "--token", token, "--json"]);
const assert = makeAssert("TMDB");

const results = {};

const ls = run(["ls"]);
const names = ls.data.map((c) => c.collection).sort();
assert(names.join(",") === "movies,people,tv", "ls returns movies/tv/people", ls);
results.ls = true;
await sleep(300);

const matrix = run(["get", "movies", "603"]);
assert(matrix.data.title === "The Matrix", "get resolves The Matrix", matrix);
assert(matrix.data.externalIds?.imdb?.includes("tt0133093"), "externalIds carry the IMDb id", matrix);
results.get = true;
await sleep(300);

const reverse = run(["find", "movies", "--where", "imdb=tt0133093"]);
assert(reverse.data.some((r) => r.id === 603), "reverse lookup by IMDb id finds movie 603", reverse);
results.reverseFind = true;
await sleep(300);

const search = run(["find", "movies", "--where", "title=The Matrix", "--limit", "5"]);
assert(search.data.some((r) => r.id === 603), "title search surfaces movie 603", search);
results.find = true;
await sleep(300);

const missing = run(["get", "movies", "2147483640"], { expectFailure: true });
assert(missing.ok === false && missing.error.code === "NOT_FOUND", "missing movie is NOT_FOUND", missing);
results.notFound = true;

const create = run(["create", "movies", "--title", "x"], { expectFailure: true });
assert(create.ok === false && /read-only/i.test(create.error.message), "create is rejected as read-only", create);
results.readOnly = true;

console.log(JSON.stringify({ ok: true, adapter: "tmdb", results }, null, 2));
