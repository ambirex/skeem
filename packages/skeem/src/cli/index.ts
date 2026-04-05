import { toErrorEnvelope, writeEnvelope } from "../output/formatter.js";
import { UsageError } from "../errors/index.js";
import { SkeemRuntime, parseWhere, readExecPlanFromStdin } from "../core/runtime.js";
import type { CliGlobalOptions } from "../types/index.js";

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
  booleans: Set<string>;
}

const BOOLEAN_FLAGS = new Set([
  "json",
  "no-cache",
  "refresh",
  "dry-run",
  "yes",
  "verbose",
  "no-rollback",
  "counts",
  "allow-destructive",
  "status",
]);

const SHORT_FLAGS: Record<string, string> = {
  y: "yes",
  v: "verbose",
};

const SHORT_VALUE_FLAGS: Record<string, string> = {
  o: "output",
};

const GLOBAL_VALUE_FLAGS = new Set(["adapter", "url", "token", "profile", "actor", "context", "idempotency-key"]);

export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseArgv(argv);
  const cli = extractGlobalOptions(parsed);
  const json = cli.json || !process.stdout.isTTY;

  try {
    const command = parsed.positionals[0];
    if (!command) {
      throw new UsageError(helpText());
    }

    const runtime = await SkeemRuntime.create(process.cwd(), cli);
    const rest = parsed.positionals.slice(1);

    switch (command) {
      case "ls": {
        writeEnvelope(await runtime.ls({ counts: parsed.booleans.has("counts") }), { json });
        return;
      }
      case "get": {
        const [collection, id] = rest;
        if (!collection || id === undefined) {
          throw new UsageError("Usage: skeem get <collection> <id> [--expand relation]");
        }
        writeEnvelope(
          await runtime.get(collection, parsePrimaryKey(id), {
            expand: parsed.flags.get("expand") ?? [],
            cli,
          }),
          { json },
        );
        return;
      }
      case "describe": {
        const [collection] = rest;
        if (!collection) {
          throw new UsageError("Usage: skeem describe <collection>");
        }
        writeEnvelope(await runtime.describe(collection), { json });
        return;
      }
      case "discover": {
        writeEnvelope(
          await runtime.discover({
            collections: rest,
            outputPath: parsed.flags.get("output")?.at(-1),
          }),
          { json },
        );
        return;
      }
      case "diff": {
        const [schemaPath] = rest;
        if (!schemaPath) {
          throw new UsageError("Usage: skeem diff <schema-file> [--direction define|discover]");
        }
        writeEnvelope(
          await runtime.diff(schemaPath, {
            direction: parseDiffDirection(parsed.flags.get("direction")?.at(-1)),
            cli,
          }),
          { json },
        );
        return;
      }
      case "define": {
        const schemaPath = rest[0] ?? parsed.flags.get("from")?.at(-1);
        if (!schemaPath) {
          throw new UsageError("Usage: skeem define <schema-file> [--dry-run] [--yes] [--allow-destructive]");
        }
        writeEnvelope(await runtime.define(schemaPath, cli), { json });
        return;
      }
      case "init": {
        writeEnvelope(await runtime.init(cli, { statusOnly: parsed.booleans.has("status") }), { json });
        return;
      }
      case "find": {
        const [collection] = rest;
        if (!collection) {
          throw new UsageError("Usage: skeem find <collection> [--where field=value]");
        }
        writeEnvelope(
          await runtime.find(collection, parseWhere(parsed.flags.get("where") ?? []), {
            ...(parseOptionalInt(parsed.flags.get("limit")?.at(-1)) !== undefined
              ? { limit: parseOptionalInt(parsed.flags.get("limit")?.at(-1)) }
              : {}),
            ...(parseOptionalInt(parsed.flags.get("offset")?.at(-1)) !== undefined
              ? { offset: parseOptionalInt(parsed.flags.get("offset")?.at(-1)) }
              : {}),
            ...(parsed.flags.get("sort")?.at(-1) ? { sort: parsed.flags.get("sort")?.at(-1) } : {}),
            expand: parsed.flags.get("expand") ?? [],
            cli,
          }),
          { json },
        );
        return;
      }
      case "upsert": {
        const [collection] = rest;
        if (!collection) {
          throw new UsageError("Usage: skeem upsert <collection> --match field=value [--field value]");
        }
        writeEnvelope(
          await runtime.upsert(collection, parseWhere(parsed.flags.get("match") ?? []), extractFieldEntries(parsed, new Set(["match"])), cli),
          { json },
        );
        return;
      }
      case "create": {
        const [collection] = rest;
        if (!collection) {
          throw new UsageError("Usage: skeem create <collection> [--field value]");
        }
        writeEnvelope(await runtime.create(collection, extractFieldEntries(parsed, new Set()), cli), { json });
        return;
      }
      case "update": {
        const [collection, id] = rest;
        if (!collection || id === undefined) {
          throw new UsageError("Usage: skeem update <collection> <id> [--field value]");
        }
        writeEnvelope(await runtime.update(collection, parsePrimaryKey(id), extractFieldEntries(parsed, new Set()), cli), { json });
        return;
      }
      case "delete": {
        const [collection, id] = rest;
        if (!collection || id === undefined) {
          throw new UsageError("Usage: skeem delete <collection> <id> [--hard]");
        }
        writeEnvelope(await runtime.delete(collection, parsePrimaryKey(id), cli, { hardDelete: parsed.booleans.has("hard") }), { json });
        return;
      }
      case "restore": {
        const [collection, id] = rest;
        if (!collection || id === undefined) {
          throw new UsageError("Usage: skeem restore <collection> <id>");
        }
        writeEnvelope(await runtime.restore(collection, parsePrimaryKey(id), cli), { json });
        return;
      }
      case "claim": {
        const [targetInput] = rest;
        const lease = parsed.flags.get("lease")?.at(-1);
        if (!targetInput || !lease) {
          throw new UsageError("Usage: skeem claim <collection:id> --lease <duration> [--purpose text]");
        }
        writeEnvelope(await runtime.claim(targetInput, lease, parsed.flags.get("purpose")?.at(-1), cli), { json });
        return;
      }
      case "claims": {
        const [targetInput] = rest;
        if (!targetInput) {
          throw new UsageError("Usage: skeem claims <collection:id>");
        }
        writeEnvelope(await runtime.claims(targetInput, cli), { json });
        return;
      }
      case "release": {
        const [targetInput] = rest;
        if (!targetInput) {
          throw new UsageError("Usage: skeem release <collection:id>");
        }
        writeEnvelope(await runtime.release(targetInput, cli), { json });
        return;
      }
      case "annotate": {
        const [targetInput] = rest;
        const key = parsed.flags.get("key")?.at(-1);
        const value = parsed.flags.get("value")?.at(-1);
        if (!targetInput || !key || value === undefined) {
          throw new UsageError("Usage: skeem annotate <collection:id> --key <name> --value <json> [--expires <duration>]");
        }
        writeEnvelope(await runtime.annotate(targetInput, key, value, parsed.flags.get("expires")?.at(-1), cli), { json });
        return;
      }
      case "link": {
        const [sourceInput, relationOrTargetInput, maybeTargetInput] = rest;
        if (!sourceInput || !relationOrTargetInput) {
          throw new UsageError("Usage: skeem link <collection:id> <related_collection:id> | skeem link <collection:id> <relation> <target>");
        }
        writeEnvelope(await runtime.link(sourceInput, relationOrTargetInput, maybeTargetInput, cli), { json });
        return;
      }
      case "unlink": {
        const [sourceInput, relationOrTargetInput, maybeTargetInput] = rest;
        if (!sourceInput || !relationOrTargetInput) {
          throw new UsageError("Usage: skeem unlink <collection:id> <related_collection:id> | skeem unlink <collection:id> <relation> <target>");
        }
        writeEnvelope(await runtime.unlink(sourceInput, relationOrTargetInput, maybeTargetInput, cli), { json });
        return;
      }
      case "alias": {
        const [subcommand, ...aliasArgs] = rest;
        switch (subcommand) {
          case "add": {
            const [targetInput, aliasValue] = aliasArgs;
            if (!targetInput || !aliasValue) {
              throw new UsageError("Usage: skeem alias add <collection:id> <alias>");
            }
            writeEnvelope(await runtime.aliasAdd(targetInput, aliasValue, cli), { json });
            return;
          }
          case "list": {
            const [targetInput] = aliasArgs;
            if (!targetInput) {
              throw new UsageError("Usage: skeem alias list <collection:id>");
            }
            writeEnvelope(await runtime.aliasList(targetInput, cli), { json });
            return;
          }
          case "remove": {
            const [targetInput, aliasValue] = aliasArgs;
            if (!targetInput || !aliasValue) {
              throw new UsageError("Usage: skeem alias remove <collection:id> <alias>");
            }
            writeEnvelope(await runtime.aliasRemove(targetInput, aliasValue, cli), { json });
            return;
          }
          case "search": {
            const [collection, term] = aliasArgs;
            if (!collection || !term) {
              throw new UsageError("Usage: skeem alias search <collection> <term>");
            }
            writeEnvelope(await runtime.aliasSearch(collection, term, cli), { json });
            return;
          }
          default:
            throw new UsageError("Usage: skeem alias <add|list|remove|search> ...");
        }
      }
      case "exec": {
        writeEnvelope(await runtime.exec(await readExecPlanFromStdin(), cli), { json });
        return;
      }
      case "cache": {
        const [subcommand] = rest;
        if (subcommand === "show") {
          writeEnvelope(await runtime.cacheShow(), { json });
          return;
        }
        if (subcommand === "clear") {
          writeEnvelope(await runtime.cacheClear(), { json });
          return;
        }
        throw new UsageError("Usage: skeem cache <show|clear>");
      }
      default:
        throw new UsageError(helpText());
    }
  } catch (error) {
    const command = parsed.positionals[0];
    writeEnvelope(toErrorEnvelope(error, command), { json });
    process.exitCode = 1;
  }
}

function parseArgv(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  const booleans = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (token.startsWith("--")) {
      const equalsIndex = token.indexOf("=");
      const name = token.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
      if (equalsIndex !== -1) {
        appendFlag(flags, name, token.slice(equalsIndex + 1));
        continue;
      }

      if (BOOLEAN_FLAGS.has(name)) {
        booleans.add(name);
        continue;
      }

      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        booleans.add(name);
        continue;
      }
      appendFlag(flags, name, next);
      index += 1;
      continue;
    }

    if (token.startsWith("-") && token.length === 2) {
      const expanded = SHORT_FLAGS[token.slice(1)];
      if (expanded) {
        booleans.add(expanded);
        continue;
      }

      const expandedValue = SHORT_VALUE_FLAGS[token.slice(1)];
      if (expandedValue) {
        const next = argv[index + 1];
        if (next === undefined || next.startsWith("-")) {
          throw new UsageError(`Expected a value after ${token}.`);
        }
        appendFlag(flags, expandedValue, next);
        index += 1;
        continue;
      }
    }

    positionals.push(token);
  }

  return { positionals, flags, booleans };
}

function extractGlobalOptions(parsed: ParsedArgs): CliGlobalOptions {
  const contextRaw = parsed.flags.get("context")?.at(-1);
  return {
    ...(parsed.flags.get("adapter")?.at(-1) ? { adapter: parsed.flags.get("adapter")?.at(-1) } : {}),
    ...(parsed.flags.get("url")?.at(-1) ? { url: parsed.flags.get("url")?.at(-1) } : {}),
    ...(parsed.flags.get("token")?.at(-1) ? { token: parsed.flags.get("token")?.at(-1) } : {}),
    ...(parsed.flags.get("profile")?.at(-1) ? { profile: parsed.flags.get("profile")?.at(-1) } : {}),
    json: parsed.booleans.has("json"),
    noCache: parsed.booleans.has("no-cache"),
    refresh: parsed.booleans.has("refresh"),
    dryRun: parsed.booleans.has("dry-run"),
    yes: parsed.booleans.has("yes"),
    verbose: parsed.booleans.has("verbose"),
    noRollback: parsed.booleans.has("no-rollback"),
    allowDestructive: parsed.booleans.has("allow-destructive"),
    ...(parsed.flags.get("actor")?.at(-1) ? { actor: parsed.flags.get("actor")?.at(-1) } : {}),
    ...(contextRaw ? { context: parseJsonObject(contextRaw) } : {}),
    ...(parsed.flags.get("idempotency-key")?.at(-1)
      ? { idempotencyKey: parsed.flags.get("idempotency-key")?.at(-1) }
      : {}),
  };
}

function extractFieldEntries(parsed: ParsedArgs, additionalKnownFlags: Set<string>): Array<[string, string]> {
  const knownFlags = new Set<string>([
    ...GLOBAL_VALUE_FLAGS,
    "where",
    "match",
    "output",
    "limit",
    "offset",
    "sort",
    "expand",
    ...additionalKnownFlags,
  ]);

  const entries: Array<[string, string]> = [];
  for (const [key, values] of parsed.flags.entries()) {
    if (knownFlags.has(key)) {
      continue;
    }
    for (const value of values) {
      entries.push([key, value]);
    }
  }
  return entries;
}

function appendFlag(flags: Map<string, string[]>, name: string, value: string): void {
  const existing = flags.get(name) ?? [];
  existing.push(value);
  flags.set(name, existing);
}

function parsePrimaryKey(value: string): string | number {
  return /^-?\d+$/.test(value) ? Number.parseInt(value, 10) : value;
}

function parseOptionalInt(value?: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Number.parseInt(value, 10);
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError("Expected --context to be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function parseDiffDirection(value?: string): "define" | "discover" {
  if (value === undefined) {
    return "define";
  }
  if (value === "define" || value === "discover") {
    return value;
  }
  throw new UsageError('Expected --direction to be either "define" or "discover".');
}

function helpText(): string {
  return [
    "skeem",
    "",
    "Usage:",
    "  skeem ls [--counts]",
    "  skeem describe <collection>",
    "  skeem discover [collection ...] [-o path]",
    "  skeem diff <schema-file> [--direction define|discover]",
    "  skeem define <schema-file> [--dry-run] [--yes] [--allow-destructive]",
    "  skeem init [--status]",
    "  skeem get <collection> <id> [--expand relation]",
    "  skeem find <collection> [--where field=value] [--limit N] [--offset N] [--sort field]",
    "  skeem upsert <collection> --match field=value [--field value]",
    "  skeem create <collection> [--field value]",
    "  skeem update <collection> <id> [--field value]",
    "  skeem delete <collection> <id> [--hard]",
    "  skeem restore <collection> <id>",
    "  skeem claim <collection:id> --lease <duration> [--purpose text]",
    "  skeem claims <collection:id>",
    "  skeem release <collection:id>",
    "  skeem annotate <collection:id> --key <name> --value <json> [--expires <duration>]",
    "  skeem link <collection:id> <related_collection:id>",
    "  skeem link <collection:id> <relation> <target>",
    "  skeem unlink <collection:id> <related_collection:id>",
    "  skeem unlink <collection:id> <relation> <target>",
    "  skeem alias add <collection:id> <alias>",
    "  skeem alias list <collection:id>",
    "  skeem alias remove <collection:id> <alias>",
    "  skeem alias search <collection> <term>",
    "  skeem exec < plan.json",
    "  skeem cache <show|clear>",
  ].join("\n");
}
