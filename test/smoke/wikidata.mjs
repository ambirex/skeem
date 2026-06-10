#!/usr/bin/env node
// Live smoke for the read-only WikiData adapter. Hits the public WikiData API
// (no auth) and asserts get/find behavior plus the read-only guard. Network-
// dependent by nature; intended for `npm run smoke:wikidata` and an
// informational CI job rather than a hard gate.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const cli = path.join(repoRoot, "packages", "skeem", "dist", "bin", "skeem.js");
const base = ["--adapter", "wikidata", "--url", "https://www.wikidata.org", "--json"];

function run(args, { expectFailure = false } = {}) {
  const result = spawnSync("node", [cli, ...args, ...base], { encoding: "utf8" });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Non-JSON output for "${args.join(" ")}":\n${result.stdout}\n${result.stderr}`);
  }
  if (!expectFailure && !parsed.ok) {
    throw new Error(`"${args.join(" ")}" failed: ${JSON.stringify(parsed.error)}`);
  }
  return parsed;
}

function assert(condition, label, payload) {
  if (!condition) {
    throw new Error(`WikiData smoke failed: ${label}\n${JSON.stringify(payload, null, 2)}`);
  }
}

const results = {};

const ls = run(["ls"]);
const names = ls.data.map((c) => c.collection).sort();
assert(names.join(",") === "items,properties", "ls returns items + properties", ls);
results.ls = true;

const douglas = run(["get", "items", "Q42"]);
assert(douglas.data.label === "Douglas Adams", "get Q42 resolves Douglas Adams", douglas);
assert(Array.isArray(douglas.data.claims?.P31) && douglas.data.claims.P31.includes("Q5"), "Q42 is an instance of human (P31 -> Q5)", douglas);
results.get = true;

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
