#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runConformanceSuite } from "./suite.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const adapterArg = process.argv.indexOf("--adapter");
const adapterName = adapterArg !== -1 ? process.argv[adapterArg + 1] : undefined;
if (!adapterName) {
  console.error("Usage: node test/conformance/run.mjs --adapter <name>");
  process.exit(2);
}

const fixtureModule = await import(path.join(__dirname, "fixtures", `${adapterName}.mjs`));
const fixture = await fixtureModule.createFixture();

let exitCode = 0;
try {
  await fixture.start();
  await fixture.waitReady();
  const results = await runConformanceSuite(fixture);
  console.log(JSON.stringify({ ok: true, adapter: fixture.name, tier: fixture.tier, results }, null, 2));
} catch (error) {
  exitCode = 1;
  console.error(`\nConformance suite failed for "${adapterName}":\n${error?.stack ?? error}`);
} finally {
  try {
    await fixture.stop();
  } catch (error) {
    console.error(`Teardown error: ${error}`);
  }
}

process.exit(exitCode);
