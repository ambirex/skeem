#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { parseServerArgs } from "../src/args.js";
import { createSkeemMcpServer } from "../src/server.js";

function readVersion(): string {
  try {
    // From dist/bin/skeem-mcp.js, package.json sits two levels up.
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0-dev";
  } catch {
    return "0.0.0-dev";
  }
}

async function main(): Promise<void> {
  const args = parseServerArgs(process.argv.slice(2));
  const server = createSkeemMcpServer({
    baseCli: args.baseCli,
    cwd: args.cwd,
    readOnly: args.readOnly,
    version: readVersion(),
  });
  await server.connect(new StdioServerTransport());
  // stdout is the protocol stream; diagnostics go to stderr only.
  process.stderr.write("skeem-mcp: ready on stdio\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`skeem-mcp: ${message}\n`);
  process.exitCode = 1;
});
