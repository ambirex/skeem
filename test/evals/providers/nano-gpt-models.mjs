#!/usr/bin/env node

import { loadDotEnv } from "./env.mjs";

const DEFAULT_MODELS_URL = "https://nano-gpt.com/api/v1/models?detailed=true";

async function main() {
  await loadDotEnv(process.cwd());

  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.NANO_GPT_API_KEY ?? process.env.OPENAI_API_KEY;
  const endpoint = resolveEndpoint(args);
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      ...(apiKey
        ? {
            Authorization: `Bearer ${apiKey}`,
            "x-api-key": apiKey,
          }
        : {}),
    },
  });

  const body = await response.json().catch(async () => ({
    error: {
      message: await response.text(),
    },
  }));

  if (!response.ok) {
    const errorMessage = body?.error?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(`Nano-GPT model listing failed: ${errorMessage}`);
  }

  const models = Array.isArray(body?.data) ? body.data : [];
  const filtered = args.model
    ? models.filter((entry) => entry?.id === args.model)
    : models;

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ object: body.object ?? "list", data: filtered }, null, 2)}\n`);
    return;
  }

  if (filtered.length === 0) {
    process.stdout.write("No models matched.\n");
    return;
  }

  for (const model of filtered.slice(0, args.limit)) {
    process.stdout.write(formatModel(model));
    process.stdout.write("\n");
  }
}

function parseArgs(argv) {
  const parsed = {
    json: false,
    limit: 20,
    model: undefined,
    endpoint: "canonical",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--json":
        parsed.json = true;
        break;
      case "--limit":
        parsed.limit = Number.parseInt(argv[index + 1], 10);
        index += 1;
        break;
      case "--model":
        parsed.model = argv[index + 1];
        index += 1;
        break;
      case "--subscription":
        parsed.endpoint = "subscription";
        break;
      case "--paid":
        parsed.endpoint = "paid";
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return parsed;
}

function resolveEndpoint(args) {
  switch (args.endpoint) {
    case "subscription":
      return "https://nano-gpt.com/api/subscription/v1/models?detailed=true";
    case "paid":
      return "https://nano-gpt.com/api/paid/v1/models?detailed=true";
    default:
      return DEFAULT_MODELS_URL;
  }
}

function formatModel(model) {
  const capabilities = Object.entries(model.capabilities ?? {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([name]) => name)
    .join(", ");

  return [
    `${model.id}`,
    `  name: ${model.name ?? "(unnamed)"}`,
    `  context: ${model.context_length ?? "unknown"}`,
    `  max_output_tokens: ${model.max_output_tokens ?? "unknown"}`,
    `  capabilities: ${capabilities || "(none flagged true)"}`,
    ...(model.subscription ? [`  subscription: ${model.subscription.included ? "included" : "not included"}`] : []),
    ...(model.pricing ? [`  pricing: ${model.pricing.prompt}/${model.pricing.completion} ${model.pricing.currency} ${model.pricing.unit}`] : []),
  ].join("\n");
}

await main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
