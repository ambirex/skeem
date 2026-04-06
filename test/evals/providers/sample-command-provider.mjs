#!/usr/bin/env node

import { readJsonFromStdin } from "./shared.mjs";

const payload = await readJsonFromStdin();
const commandSteps = Array.isArray(payload.execution)
  ? payload.execution.filter((step) => step.type === "command").length
  : 0;

switch (payload.case?.id) {
  case "discovery-and-read": {
    if (commandSteps === 0) {
      respond({ type: "command", command: "skeem ls --json" });
    } else if (commandSteps === 1) {
      respond({ type: "command", command: "skeem describe people --json" });
    } else if (commandSteps === 2) {
      respond({ type: "command", command: "skeem find people --where name=Jane --json" });
    } else if (commandSteps === 3) {
      respond({ type: "command", command: `skeem get companies ${payload.seed?.companies?.acme?.id ?? 1} --json` });
    } else {
      respond({ type: "answer", text: "Jane belongs to Acme." });
    }
    break;
  }
  default:
    respond({ type: "answer", text: `No sample provider logic is implemented for case ${payload.case?.id ?? "unknown"}.` });
}

function respond(step) {
  process.stdout.write(`${JSON.stringify(step, null, 2)}\n`);
}
