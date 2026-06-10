// Shared helpers for the live-API smoke scripts (wikidata, musicbrainz, osm,
// openlibrary, crossref, tmdb). Each smoke spawns the built CLI against a public
// backend and asserts on the JSON envelopes.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "../..");
export const cliEntry = path.join(repoRoot, "packages", "skeem", "dist", "bin", "skeem.js");

/**
 * Build a runner bound to an adapter's base flags. Returns
 * `run(args, { expectFailure })` which spawns the CLI, parses the JSON
 * envelope, and throws on unexpected failure.
 */
export function createRunner(baseFlags) {
  return function run(args, { expectFailure = false } = {}) {
    const result = spawnSync("node", [cliEntry, ...args, ...baseFlags], { encoding: "utf8" });
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
  };
}

export function makeAssert(adapterName) {
  return function assert(condition, label, payload) {
    if (!condition) {
      throw new Error(`${adapterName} smoke failed: ${label}\n${JSON.stringify(payload, null, 2)}`);
    }
  };
}

/** Pause between CLI invocations — each spawn is its own process, so the
 *  adapter's in-process throttle can't space them for rate-limited sources. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
