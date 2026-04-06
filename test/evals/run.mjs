#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadDotEnv } from "./providers/env.mjs";
import { createEvalProvider } from "./providers/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const evalRoot = path.join(repoRoot, "test", ".tmp", "eval-harness");
const fixtureLockPath = path.join(evalRoot, "fixture.lock");
const sharedProjectDir = path.join(evalRoot, "directus-project");
const sharedDatabaseDir = path.join(sharedProjectDir, "database");
const sharedUploadsDir = path.join(sharedProjectDir, "uploads");
const sharedExtensionsDir = path.join(sharedProjectDir, "extensions");
const runsDir = path.join(evalRoot, "runs");
const resultsDir = path.join(repoRoot, "test", "evals", "results");
const skeemBinPath = path.join(repoRoot, "packages", "skeem", "dist", "bin", "skeem.js");

const directusVersion = "11.17.1";
const sqliteVersion = "6.0.1";
const host = "127.0.0.1";
const port = 18065;
const baseUrl = `http://${host}:${port}`;
const adminEmail = "admin@example.com";
const adminPassword = "testpassword";
const adminToken = "skeem-admin-token";

const OPERATOR_PROMPT = [
  "You are operating a relational CLI called skeem against a Directus backend.",
  "Discover before mutating when the schema is uncertain.",
  "Prefer skeem commands over guessing raw backend details.",
  "Return only the next skeem command to run, or a JSON exec plan when a multi-step plan is clearly warranted.",
  "When a write may be retried, include --idempotency-key.",
  "When coordination matters, include --actor.",
].join("\n");

const PROVIDER_RESPONSE_PROMPT = [
  "Return exactly one JSON object and nothing else.",
  'For a command, return: {"type":"command","command":"skeem ...","stdin":{...optional...}}.',
  'For a final answer, return: {"type":"answer","text":"..."}',
  "Only use the skeem CLI. Do not emit raw backend API calls or shell pipelines.",
  "If you need skeem exec, put the plan JSON in the optional stdin field instead of using shell redirection.",
].join("\n");

const MUTATION_VERBS = new Set([
  "create",
  "update",
  "delete",
  "restore",
  "upsert",
  "link",
  "unlink",
  "claim",
  "release",
  "annotate",
  "alias",
  "init",
  "exec",
]);

const DISCOVERY_VERBS = new Set([
  "ls",
  "describe",
  "discover",
  "get",
  "find",
  "claims",
  "diff",
  "cache",
]);

let capturedStdout = "";
let capturedStderr = "";

async function main() {
  await loadDotEnv(repoRoot);

  const args = parseArgs(process.argv.slice(2));
  if (!args.casePath) {
    throw new Error("Usage: node test/evals/run.mjs --case <case.json> [--transcript <transcript.json> | --provider <name>] [--output <result.json>] [--keep-run-dir]");
  }

  await ensureBuiltCli();

  const absoluteCasePath = path.resolve(repoRoot, args.casePath);
  const caseDefinition = JSON.parse(await readFile(absoluteCasePath, "utf8"));
  const runId = `${caseDefinition.id}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = path.join(runsDir, runId);
  const workspaceDir = path.join(runDir, "workspace");
  const binDir = path.join(runDir, "bin");
  const promptPath = path.join(runDir, "prompt.txt");
  const transcriptOutputPath = path.join(runDir, "transcript.record.json");
  const providerTracePath = path.join(runDir, "provider.record.json");
  const defaultResultPath = path.join(resultsDir, `${runId}.json`);
  const resultPath = args.outputPath ? path.resolve(repoRoot, args.outputPath) : defaultResultPath;

  let serverProcess;
  let fixtureLockHeld = false;

  try {
    await mkdir(runDir, { recursive: true });
    await mkdir(resultsDir, { recursive: true });

    await acquireFixtureLock();
    fixtureLockHeld = true;
    await ensureFixtureProject();
    await stopExistingDirectus();
    await resetDatabase();
    await bootstrapDirectus();
    serverProcess = startDirectus();

    await waitForDirectus();
    const seed = await prepareEvalBackend();
    const runContext = await prepareRunWorkspace({
      runDir,
      workspaceDir,
      binDir,
      caseDefinition,
      seed,
    });
    runContext.caseDefinition = caseDefinition;
    const promptBundle = buildPromptBundle(caseDefinition, runContext);
    await writeFile(promptPath, `${promptBundle}\n`);

    if (!args.transcriptPath && !args.provider) {
      const result = {
        status: "awaiting_transcript",
        case: summarizeCase(caseDefinition, absoluteCasePath),
        promptPath,
        promptBundle,
        workspaceDir,
        artifacts: runContext.artifacts,
        seed,
      };
      await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify({ ok: true, status: "awaiting_transcript", promptPath, resultPath }, null, 2)}\n`);
      process.stdout.write(`\n--- Prompt Bundle ---\n${promptBundle}\n`);
      return;
    }

    let transcriptSource;
    let transcript;
    let execution;
    let providerInfo;

    try {
      if (args.transcriptPath) {
        const absoluteTranscriptPath = path.resolve(repoRoot, args.transcriptPath);
        transcript = parseTranscript(JSON.parse(await readFile(absoluteTranscriptPath, "utf8")));
        execution = executeTranscript(transcript, runContext);
        transcriptSource = {
          mode: "transcript",
          transcriptPath: absoluteTranscriptPath,
        };
      } else {
        const provider = await createEvalProvider({
          provider: args.provider,
          command: args.providerCommand,
          cwd: repoRoot,
          model: args.model,
          baseUrl: args.providerBaseUrl,
          maxOutputTokens: args.maxOutputTokens,
          reasoningEffort: args.reasoningEffort,
        });
        const providerRun = await executeWithProvider({
          provider,
          caseDefinition,
          runContext,
          maxSteps: args.maxSteps,
        });
        transcript = providerRun.transcript;
        execution = providerRun.execution;
        providerInfo = {
          name: provider.name,
          metadata: provider.metadata,
          tracePath: providerTracePath,
        };
        transcriptSource = {
          mode: "provider",
          provider: providerInfo,
        };
        await writeFile(providerTracePath, `${JSON.stringify(providerRun.providerTrace, null, 2)}\n`);
      }

      await writeFile(transcriptOutputPath, `${JSON.stringify({ transcript, execution }, null, 2)}\n`);

      const verification = await verifyCase({
        caseDefinition,
        execution,
        runContext,
      });

      const result = {
        status: "completed",
        case: summarizeCase(caseDefinition, absoluteCasePath),
        transcriptRecordPath: transcriptOutputPath,
        promptPath,
        promptBundle,
        workspaceDir,
        artifacts: runContext.artifacts,
        seed,
        transcriptSource,
        execution,
        verification,
      };
      if (transcriptSource.mode === "transcript") {
        result.transcriptPath = transcriptSource.transcriptPath;
      }
      if (providerInfo) {
        result.provider = providerInfo;
      }
      await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify({ ok: verification.passed, resultPath, summary: verification.summary }, null, 2)}\n`);
      process.exitCode = verification.passed ? 0 : 1;
    } catch (error) {
      const result = {
        status: "failed",
        case: summarizeCase(caseDefinition, absoluteCasePath),
        promptPath,
        promptBundle,
        workspaceDir,
        artifacts: runContext.artifacts,
        seed,
        ...(transcriptSource ? { transcriptSource } : {}),
        ...(execution ? { execution } : {}),
        ...(providerInfo ? { provider: providerInfo } : {}),
        error: {
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        },
      };
      await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify({ ok: false, resultPath, summary: result.error.message }, null, 2)}\n`);
      process.exitCode = 1;
    }
  } finally {
    await stopExistingDirectus(serverProcess);
    if (fixtureLockHeld) {
      await releaseFixtureLock();
    }
    if (!args.keepRunDir) {
      await rm(path.join(runDir, "workspace", ".skeem"), { recursive: true, force: true });
    }
  }
}

function parseArgs(argv) {
  const parsed = {
    casePath: undefined,
    transcriptPath: undefined,
    outputPath: undefined,
    provider: undefined,
    providerCommand: undefined,
    providerBaseUrl: undefined,
    model: undefined,
    maxOutputTokens: undefined,
    reasoningEffort: undefined,
    maxSteps: undefined,
    keepRunDir: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--case":
        parsed.casePath = argv[index + 1];
        index += 1;
        break;
      case "--transcript":
        parsed.transcriptPath = argv[index + 1];
        index += 1;
        break;
      case "--output":
        parsed.outputPath = argv[index + 1];
        index += 1;
        break;
      case "--provider":
        parsed.provider = argv[index + 1];
        index += 1;
        break;
      case "--provider-command":
        parsed.providerCommand = argv[index + 1];
        index += 1;
        break;
      case "--provider-base-url":
        parsed.providerBaseUrl = argv[index + 1];
        index += 1;
        break;
      case "--model":
        parsed.model = argv[index + 1];
        index += 1;
        break;
      case "--max-output-tokens":
        parsed.maxOutputTokens = Number.parseInt(argv[index + 1], 10);
        index += 1;
        break;
      case "--reasoning-effort":
        parsed.reasoningEffort = argv[index + 1];
        index += 1;
        break;
      case "--max-steps":
        parsed.maxSteps = Number.parseInt(argv[index + 1], 10);
        index += 1;
        break;
      case "--keep-run-dir":
        parsed.keepRunDir = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return parsed;
}

function summarizeCase(caseDefinition, casePath) {
  return {
    id: caseDefinition.id,
    title: caseDefinition.title,
    category: caseDefinition.category,
    path: casePath,
  };
}

async function ensureBuiltCli() {
  if (!(await exists(skeemBinPath))) {
    throw new Error(`Missing built CLI at ${skeemBinPath}. Run "npm run build" first.`);
  }
}

async function acquireFixtureLock() {
  await mkdir(evalRoot, { recursive: true });
  try {
    await writeFile(
      fixtureLockPath,
      `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }, null, 2)}\n`,
      { flag: "wx" },
    );
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }

    const existing = await readLockFile();
    if (existing?.pid && isProcessAlive(existing.pid)) {
      throw new Error(`Another eval harness is already using the shared Directus fixture (pid ${existing.pid}). Wait for it to finish and retry.`);
    }

    await rm(fixtureLockPath, { force: true });
    await writeFile(
      fixtureLockPath,
      `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }, null, 2)}\n`,
      { flag: "wx" },
    );
  }
}

async function releaseFixtureLock() {
  await rm(fixtureLockPath, { force: true });
}

async function readLockFile() {
  try {
    return JSON.parse(await readFile(fixtureLockPath, "utf8"));
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureFixtureProject() {
  await mkdir(sharedProjectDir, { recursive: true });
  await mkdir(sharedDatabaseDir, { recursive: true });
  await mkdir(sharedUploadsDir, { recursive: true });
  await mkdir(sharedExtensionsDir, { recursive: true });

  await writeFile(
    path.join(sharedProjectDir, "package.json"),
    JSON.stringify(
      {
        name: "skeem-directus-eval-fixture",
        private: true,
        type: "module",
        dependencies: {
          directus: directusVersion,
          sqlite3: sqliteVersion,
        },
      },
      null,
      2,
    ),
  );

  await writeFile(
    path.join(sharedProjectDir, ".env"),
    [
      `HOST=${host}`,
      `PORT=${port}`,
      "KEY=skeem-eval-key",
      "SECRET=skeem-eval-secret",
      "DB_CLIENT=sqlite3",
      "DB_FILENAME=./database/data.db",
      `PUBLIC_URL=${baseUrl}`,
      `ADMIN_EMAIL=${adminEmail}`,
      `ADMIN_PASSWORD=${adminPassword}`,
      `ADMIN_TOKEN=${adminToken}`,
      "WEBSOCKETS_ENABLED=true",
    ].join("\n"),
  );

  if (!(await exists(path.join(sharedProjectDir, "node_modules")))) {
    const install = runCommand("npm", ["install", "--no-fund", "--no-audit"], { cwd: sharedProjectDir });
    if (install.status !== 0) {
      throw new Error(`Failed to install eval fixture dependencies:\n${install.stderr || install.stdout}`);
    }
  }
}

async function resetDatabase() {
  await rm(sharedDatabaseDir, { recursive: true, force: true });
  await mkdir(sharedDatabaseDir, { recursive: true });
}

async function bootstrapDirectus() {
  const bootstrap = runCommand("npx", ["directus", "bootstrap"], { cwd: sharedProjectDir });
  if (bootstrap.status !== 0) {
    throw new Error(`Failed to bootstrap Directus eval fixture:\n${bootstrap.stderr || bootstrap.stdout}`);
  }
}

function startDirectus() {
  capturedStdout = "";
  capturedStderr = "";

  const child = spawn("npx", ["directus", "start"], {
    cwd: sharedProjectDir,
    env: process.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    capturedStdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    capturedStderr += chunk.toString();
  });
  child.on("exit", (code) => {
    if (code !== 0) {
      capturedStderr += `\nDirectus exited with code ${code}.`;
    }
  });

  return child;
}

async function waitForDirectus() {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/collections`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          Accept: "application/json",
        },
      });

      if (response.ok) {
        return;
      }
    } catch {
      // Wait while the fixture starts.
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for Directus.\nSTDOUT:\n${capturedStdout}\nSTDERR:\n${capturedStderr}`);
}

async function prepareEvalBackend() {
  await ensureCollection({
    name: "widgets",
    fields: [
      stringField("name", { required: true }),
      stringField("status"),
    ],
  });
  await ensureCollection({
    name: "companies",
    fields: [
      stringField("name", { required: true, unique: true }),
      stringField("industry"),
    ],
  });
  await ensureCollection({
    name: "people",
    fields: [
      stringField("name", { required: true }),
      integerField("company_id"),
      stringField("role"),
    ],
  });
  await ensureRelation({
    collectionMany: "people",
    fieldMany: "company_id",
    collectionOne: "companies",
  });

  const acme = await createItem("companies", {
    name: "Acme",
    industry: "Manufacturing",
  });
  const globex = await createItem("companies", {
    name: "Globex",
    industry: "Logistics",
  });
  const jane = await createItem("people", {
    name: "Jane",
    company_id: acme.id,
    role: "Account Manager",
  });
  const raj = await createItem("people", {
    name: "Raj",
    company_id: globex.id,
    role: "Operations Lead",
  });
  const widgetAlpha = await createItem("widgets", {
    name: "Widget Alpha",
    status: "active",
  });
  const widgetBeta = await createItem("widgets", {
    name: "Widget Beta",
    status: "inactive",
  });

  return {
    companies: { acme, globex },
    people: { jane, raj },
    widgets: { widgetAlpha, widgetBeta },
  };
}

async function prepareRunWorkspace(input) {
  await mkdir(input.workspaceDir, { recursive: true });
  await mkdir(input.binDir, { recursive: true });

  await writeFile(
    path.join(input.workspaceDir, ".skeemrc.yaml"),
    [
      "default: local",
      "actor: eval-runner",
      "profiles:",
      "  local:",
      "    adapter: directus",
      "    connection:",
      `      url: \"${baseUrl}\"`,
      `      token: \"${adminToken}\"`,
      "    schema:",
      "      aliases:",
      "        firm: companies",
      "schema:",
      "  exclude:",
      "    - directus_*",
      "cache:",
      "  ttl_seconds: 3600",
    ].join("\n"),
  );

  await writeFile(
    path.join(input.binDir, "skeem"),
    [
      "#!/bin/sh",
      `node "${skeemBinPath}" "$@"`,
    ].join("\n"),
    { mode: 0o755 },
  );

  const artifacts = await createCaseArtifacts({
    caseDefinition: input.caseDefinition,
    workspaceDir: input.workspaceDir,
    seed: input.seed,
    binDir: input.binDir,
  });

  return {
    workspaceDir: input.workspaceDir,
    env: {
      ...process.env,
      PATH: `${input.binDir}:${process.env.PATH ?? ""}`,
    },
    seed: input.seed,
    artifacts,
  };
}

async function createCaseArtifacts(input) {
  const artifacts = {};

  if (input.caseDefinition.id === "schema-drift-review") {
    const discovered = await runSkeemJson(["discover"], {
      cwd: input.workspaceDir,
      env: {
        ...process.env,
        PATH: `${input.binDir}:${process.env.PATH ?? ""}`,
      },
    });

    const schemaDocument = JSON.parse(JSON.stringify(discovered.data));
    delete schemaDocument.collections.widgets;
    schemaDocument.collections.people.fields.title = {
      type: "string",
    };
    schemaDocument.collections.archived_people = {
      fields: {
        name: {
          type: "string",
          required: true,
        },
      },
    };

    const schemaFile = path.join(input.workspaceDir, "schema-review.json");
    await writeFile(schemaFile, `${JSON.stringify(schemaDocument, null, 2)}\n`);
    artifacts.schemaFile = schemaFile;
  }

  return artifacts;
}

function buildPromptBundle(caseDefinition, runContext) {
  return [OPERATOR_PROMPT, "", buildTaskBrief(caseDefinition, runContext)].join("\n");
}

function buildTaskBrief(caseDefinition, runContext) {
  const lines = [
    `Working directory: ${runContext.workspaceDir}`,
    "A .skeemrc.yaml file is already configured in that directory.",
    "The skeem command is available on PATH inside the harness workspace.",
    "",
    `Case: ${caseDefinition.title}`,
    `Goal: ${caseDefinition.goal}`,
    "",
    "Task Prompt:",
    caseDefinition.prompt,
  ];

  if (runContext.artifacts.schemaFile) {
    lines.push("", `Schema file available at: ${runContext.artifacts.schemaFile}`);
  }

  if (Array.isArray(caseDefinition.allowed_commands) && caseDefinition.allowed_commands.length > 0) {
    lines.push("", "Allowed command patterns:");
    for (const command of caseDefinition.allowed_commands) {
      lines.push(`- ${command}`);
    }
  }

  return lines.join("\n");
}

async function executeWithProvider(input) {
  const transcript = [];
  const execution = [];
  const providerTrace = [];
  const messages = [
    {
      role: "developer",
      content: `${OPERATOR_PROMPT}\n\n${PROVIDER_RESPONSE_PROMPT}`,
    },
    {
      role: "user",
      content: buildTaskBrief(input.caseDefinition, input.runContext),
    },
  ];
  const maxSteps = Number.isInteger(input.maxSteps) && input.maxSteps > 0 ? input.maxSteps : 12;

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    const step = await input.provider.nextStep({
      messages,
      stepIndex,
      caseDefinition: input.caseDefinition,
      runContext: input.runContext,
      execution,
    });

    providerTrace.push({
      stepIndex,
      request: {
        messages: structuredClone(messages),
      },
      response: step,
    });
    transcript.push(step);
    messages.push({
      role: "assistant",
      content: JSON.stringify(step),
    });

    if (step.type === "answer") {
      execution.push({
        index: stepIndex,
        type: "answer",
        text: step.text,
      });
      return { transcript, execution, providerTrace };
    }

    const executed = executeCommandStep(step, input.runContext, stepIndex);
    execution.push(executed);
    messages.push({
      role: "user",
      content: buildCommandResultMessage(executed),
    });
  }

  throw new Error(`Provider did not return an answer within ${maxSteps} steps.`);
}

function parseTranscript(raw) {
  const steps = Array.isArray(raw) ? raw : raw.steps;
  if (!Array.isArray(steps)) {
    throw new Error("Transcript must be a JSON array or an object with a steps array.");
  }

  return steps.map((step, index) => {
    if (!step || typeof step !== "object") {
      throw new Error(`Transcript step ${index} is not an object.`);
    }
    if (step.type === "answer") {
      if (typeof step.text !== "string") {
        throw new Error(`Transcript answer step ${index} must include text.`);
      }
      return { type: "answer", text: step.text };
    }
    if (step.type === "command" || step.type === undefined) {
      if (typeof step.command !== "string") {
        throw new Error(`Transcript command step ${index} must include command.`);
      }
      return {
        type: "command",
        command: step.command,
        stdin: step.stdin,
      };
    }
    throw new Error(`Unsupported transcript step type at index ${index}: ${step.type}`);
  });
}

function executeTranscript(transcript, runContext) {
  const execution = [];

  for (const [index, step] of transcript.entries()) {
    if (step.type === "answer") {
      execution.push({
        index,
        type: "answer",
        text: step.text,
      });
      continue;
    }

    execution.push(executeCommandStep(step, runContext, index));
  }

  return execution;
}

function executeCommandStep(step, runContext, index) {
  const expandedCommand = expandCommand(step.command, runContext);
  const classification = classifyCommand(expandedCommand, step.stdin);
  const allowed = matchesAllowedCommand(expandedCommand, runContext.caseDefinition?.allowed_commands ?? []);

  if (!isSafeSkeemCommand(expandedCommand)) {
    return {
      index,
      type: "command",
      command: step.command,
      expandedCommand,
      classification,
      allowed,
      stdin: step.stdin ?? null,
      status: 1,
      stdout: "",
      stderr: "Rejected unsafe or non-skeem command.",
    };
  }

  const input = step.stdin === undefined
    ? undefined
    : `${typeof step.stdin === "string" ? step.stdin : JSON.stringify(step.stdin, null, 2)}\n`;
  const result = runShellCommand(expandedCommand, {
    cwd: runContext.workspaceDir,
    env: runContext.env,
    input,
  });

  return {
    index,
    type: "command",
    command: step.command,
    expandedCommand,
    classification,
    allowed,
    stdin: step.stdin ?? null,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function expandCommand(command, runContext) {
  return command
    .replace(/\$WORKSPACE/g, runContext.workspaceDir)
    .replace(/\$SCHEMA_FILE/g, runContext.artifacts.schemaFile ?? "")
    .replace(/\$ACME_ID/g, String(runContext.seed.companies.acme.id))
    .replace(/\$JANE_ID/g, String(runContext.seed.people.jane.id));
}

function isSafeSkeemCommand(command) {
  const trimmed = command.trim();
  if (!trimmed.startsWith("skeem")) {
    return false;
  }

  if (trimmed.includes("\n")) {
    return false;
  }

  return !/[;&|`<>]/.test(trimmed) && !trimmed.includes("$(");
}

function buildCommandResultMessage(executed) {
  return [
    `Command: ${executed.expandedCommand}`,
    `Exit status: ${executed.status}`,
    "STDOUT:",
    truncateForProvider(executed.stdout),
    "STDERR:",
    truncateForProvider(executed.stderr),
    "Decide the next step. If the task is complete, return an answer step.",
  ].join("\n");
}

function truncateForProvider(text) {
  const value = text && text.length > 0 ? text : "(empty)";
  return value.length > 6000 ? `${value.slice(0, 6000)}\n...[truncated]...` : value;
}

function classifyCommand(command, stdin) {
  const tokens = command.trim().split(/\s+/);
  const verb = tokens[1] ?? "";

  if (verb === "define" && tokens.includes("--dry-run")) {
    return "read";
  }

  if (verb === "exec") {
    try {
      const plan = typeof stdin === "string" ? JSON.parse(stdin) : stdin;
      const operations = Array.isArray(plan?.operations) ? plan.operations : [];
      return operations.some((operation) => ["create", "update", "delete", "upsert", "link", "unlink"].includes(operation.op))
        ? "write"
        : "read";
    } catch {
      return "write";
    }
  }

  if (DISCOVERY_VERBS.has(verb)) {
    return "read";
  }

  if (MUTATION_VERBS.has(verb)) {
    return "write";
  }

  return "unknown";
}

function matchesAllowedCommand(command, allowedCommands) {
  if (!Array.isArray(allowedCommands) || allowedCommands.length === 0) {
    return true;
  }

  const commandTokens = command.trim().split(/\s+/);
  return allowedCommands.some((pattern) => {
    const prefix = pattern
      .trim()
      .split(/\s+/)
      .filter((token) => token && !token.startsWith("["))
      .slice(0, prefixLength(pattern));

    return prefix.every((token, index) => commandTokens[index] === token);
  });
}

function prefixLength(pattern) {
  const tokens = pattern.trim().split(/\s+/);
  let count = 0;
  for (const token of tokens) {
    if (!token || token.startsWith("[") || token.includes("<") || token.includes("...")) {
      break;
    }
    count += 1;
  }
  return count;
}

async function verifyCase(input) {
  const metrics = collectMetrics(input.execution);
  const verifier = CASE_VERIFIERS[input.caseDefinition.id];
  if (!verifier) {
    return {
      passed: false,
      summary: `No verifier implemented for case ${input.caseDefinition.id}.`,
      metrics,
      checks: [
        {
          name: "verifier_exists",
          passed: false,
          message: `Missing verifier for ${input.caseDefinition.id}.`,
        },
      ],
    };
  }

  const checks = await verifier({
    caseDefinition: input.caseDefinition,
    execution: input.execution,
    runContext: input.runContext,
    metrics,
  });
  const passed = checks.every((check) => check.passed);
  return {
    passed,
    summary: `${checks.filter((check) => check.passed).length}/${checks.length} checks passed`,
    metrics,
    checks,
  };
}

function collectMetrics(execution) {
  const commandSteps = execution.filter((step) => step.type === "command");
  const firstMutationIndex = commandSteps.findIndex((step) => step.classification === "write");
  const firstDiscoveryIndex = commandSteps.findIndex((step) => step.classification === "read");
  return {
    commandCount: commandSteps.length,
    answerCount: execution.filter((step) => step.type === "answer").length,
    discoveryCommands: commandSteps.filter((step) => step.classification === "read").length,
    mutationCommands: commandSteps.filter((step) => step.classification === "write").length,
    invalidCommands: commandSteps.filter((step) => step.allowed === false).length,
    commandFailures: commandSteps.filter((step) => step.status !== 0).length,
    discoveryBeforeMutation: firstMutationIndex === -1 ? commandSteps.some((step) => step.classification === "read") : (
      firstDiscoveryIndex !== -1 && firstDiscoveryIndex < firstMutationIndex
    ),
  };
}

function latestAnswerText(execution) {
  const answers = execution.filter((step) => step.type === "answer");
  return answers.length > 0 ? answers[answers.length - 1].text : "";
}

function commandSteps(execution) {
  return execution.filter((step) => step.type === "command");
}

const CASE_VERIFIERS = {
  async "discovery-and-read"(input) {
    const answer = latestAnswerText(input.execution).toLowerCase();
    return [
      {
        name: "no_write_commands",
        passed: input.metrics.mutationCommands === 0,
        message: input.metrics.mutationCommands === 0 ? "Transcript stayed read-only." : "Transcript included write commands.",
      },
      {
        name: "used_discovery_first",
        passed: input.metrics.discoveryCommands > 0,
        message: input.metrics.discoveryCommands > 0 ? "At least one discovery command was used." : "No discovery commands were used.",
      },
      {
        name: "correct_company_named",
        passed: answer.includes("acme"),
        message: answer.includes("acme") ? "Answer identifies Acme." : "Answer did not identify Acme.",
      },
      {
        name: "only_allowed_commands",
        passed: input.metrics.invalidCommands === 0,
        message: input.metrics.invalidCommands === 0 ? "All commands matched the allowed patterns." : "Some commands fell outside the allowed patterns.",
      },
    ];
  },

  async "relational-create"(input) {
    const miaRows = await runSkeemJson(["find", "people", "--where", "name=Mia"], {
      cwd: input.runContext.workspaceDir,
      env: input.runContext.env,
    });
    const acmeRows = await runSkeemJson(["find", "companies", "--where", "name=Acme"], {
      cwd: input.runContext.workspaceDir,
      env: input.runContext.env,
    });
    const mia = Array.isArray(miaRows.data) ? miaRows.data[0] : undefined;
    return [
      {
        name: "mia_created_once",
        passed: miaRows.ok && miaRows.count === 1,
        message: miaRows.ok && miaRows.count === 1 ? "Exactly one Mia record exists." : "Expected exactly one Mia record.",
      },
      {
        name: "mia_linked_to_acme",
        passed: miaRows.ok && miaRows.count === 1 && String(mia.company_id) === String(input.runContext.seed.companies.acme.id),
        message: miaRows.ok && miaRows.count === 1 && String(mia.company_id) === String(input.runContext.seed.companies.acme.id)
          ? "Mia is linked to Acme."
          : "Mia is not linked to Acme correctly.",
      },
      {
        name: "no_duplicate_acme",
        passed: acmeRows.ok && acmeRows.count === 1,
        message: acmeRows.ok && acmeRows.count === 1 ? "Acme was not duplicated." : "Acme was duplicated.",
      },
      {
        name: "discovery_before_write",
        passed: input.metrics.discoveryBeforeMutation,
        message: input.metrics.discoveryBeforeMutation ? "Discovery happened before mutation." : "Transcript wrote before discovery.",
      },
    ];
  },

  async "retriable-update"(input) {
    const keyedCommand = [...commandSteps(input.execution)].reverse().find((step) => step.expandedCommand.includes("--idempotency-key"));
    const beforeReplayVersions = await runSkeemJson([
      "find",
      "skeem_versions",
      "--where",
      "collection=companies",
      "--where",
      `record_id=${input.runContext.seed.companies.acme.id}`,
    ], {
      cwd: input.runContext.workspaceDir,
      env: input.runContext.env,
    });
    let replayStatus = null;
    if (keyedCommand) {
      replayStatus = runShellCommand(keyedCommand.expandedCommand, {
        cwd: input.runContext.workspaceDir,
        env: input.runContext.env,
        input: keyedCommand.stdin ? `${typeof keyedCommand.stdin === "string" ? keyedCommand.stdin : JSON.stringify(keyedCommand.stdin, null, 2)}\n` : undefined,
      });
    }
    const acmeRows = await runSkeemJson(["find", "companies", "--where", "name=Acme"], {
      cwd: input.runContext.workspaceDir,
      env: input.runContext.env,
    });
    const afterReplayVersions = await runSkeemJson([
      "find",
      "skeem_versions",
      "--where",
      "collection=companies",
      "--where",
      `record_id=${input.runContext.seed.companies.acme.id}`,
    ], {
      cwd: input.runContext.workspaceDir,
      env: input.runContext.env,
    });
    const acme = Array.isArray(acmeRows.data) ? acmeRows.data[0] : undefined;

    return [
      {
        name: "industry_updated",
        passed: acmeRows.ok && acmeRows.count === 1 && acme.industry === "Robotics",
        message: acmeRows.ok && acmeRows.count === 1 && acme.industry === "Robotics"
          ? "Acme industry is Robotics."
          : "Acme industry was not updated to Robotics.",
      },
      {
        name: "idempotency_key_used",
        passed: Boolean(keyedCommand),
        message: keyedCommand ? "A keyed write was used." : "No write used --idempotency-key.",
      },
      {
        name: "replay_did_not_add_side_effects",
        passed: Boolean(keyedCommand)
          && replayStatus?.status === 0
          && beforeReplayVersions.ok
          && afterReplayVersions.ok
          && beforeReplayVersions.count === afterReplayVersions.count,
        message: Boolean(keyedCommand)
          && replayStatus?.status === 0
          && beforeReplayVersions.ok
          && afterReplayVersions.ok
          && beforeReplayVersions.count === afterReplayVersions.count
          ? "Replay did not add extra version rows."
          : "Replay appears to have added side effects or failed.",
      },
    ];
  },

  async "claim-and-annotate"(input) {
    const annotationRows = await runSkeemJson([
      "find",
      "skeem_annotations",
      "--where",
      "collection=companies",
      "--where",
      `record_id=${input.runContext.seed.companies.acme.id}`,
    ], {
      cwd: input.runContext.workspaceDir,
      env: input.runContext.env,
    });
    const claims = await runSkeemJson([
      "find",
      "skeem_claims",
      "--where",
      "collection=companies",
      "--where",
      `record_id=${input.runContext.seed.companies.acme.id}`,
    ], {
      cwd: input.runContext.workspaceDir,
      env: input.runContext.env,
    });
    const actorCommands = commandSteps(input.execution)
      .filter((step) => ["claim", "release", "annotate"].includes(step.expandedCommand.trim().split(/\s+/)[1] ?? ""));
    const allUseActor = actorCommands.every((step) => step.expandedCommand.includes("--actor"));

    return [
      {
        name: "annotation_written",
        passed: annotationRows.ok && annotationRows.count >= 1,
        message: annotationRows.ok && annotationRows.count >= 1 ? "At least one annotation row exists." : "No annotation row was written.",
      },
      {
        name: "claim_released",
        passed: claims.ok && claims.count === 0,
        message: claims.ok && claims.count === 0 ? "No active claim remains." : "An active claim still exists.",
      },
      {
        name: "actor_used_on_coordination_commands",
        passed: actorCommands.length > 0 && allUseActor,
        message: actorCommands.length > 0 && allUseActor ? "Coordination commands used --actor." : "One or more coordination commands omitted --actor.",
      },
    ];
  },

  async "schema-drift-review"(input) {
    const answer = latestAnswerText(input.execution).toLowerCase();
    const commands = commandSteps(input.execution);
    const defineYesUsed = commands.some((step) => step.expandedCommand.includes(" define ") && step.expandedCommand.includes("--yes"));
    const diffOrDryRunUsed = commands.some((step) => step.expandedCommand.includes(" diff ") || (
      step.expandedCommand.includes(" define ") && step.expandedCommand.includes("--dry-run")
    ));

    return [
      {
        name: "no_live_mutation_applied",
        passed: !defineYesUsed && input.metrics.mutationCommands === 0,
        message: !defineYesUsed && input.metrics.mutationCommands === 0
          ? "No live schema mutation was applied."
          : "Transcript appears to have applied a live mutation.",
      },
      {
        name: "drift_inspected",
        passed: diffOrDryRunUsed,
        message: diffOrDryRunUsed ? "Drift was inspected with diff or dry-run define." : "Transcript never inspected drift.",
      },
      {
        name: "answer_mentions_destructive_risk",
        passed: answer.includes("destructive") || answer.includes("remove") || answer.includes("delete"),
        message: answer.includes("destructive") || answer.includes("remove") || answer.includes("delete")
          ? "Answer mentions destructive risk."
          : "Answer did not mention destructive risk.",
      },
    ];
  },
};

async function ensureCollection(definition) {
  const list = await requestJson("/collections");
  const existsAlready = Array.isArray(list.data) && list.data.some((entry) => entry.collection === definition.name);
  if (existsAlready) {
    return;
  }

  const response = await fetch(`${baseUrl}/collections`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      collection: definition.name,
      meta: {
        collection: definition.name,
        icon: "inventory_2",
      },
      schema: {
        name: definition.name,
      },
      fields: definition.fields.map((field) => ({
        ...field,
        schema: {
          ...field.schema,
          table: definition.name,
        },
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create collection "${definition.name}":\n${await response.text()}`);
  }
}

async function ensureRelation(definition) {
  const existing = await requestJson(`/relations/${definition.collectionMany}`).catch(() => ({ data: [] }));
  const existsAlready = Array.isArray(existing.data) && existing.data.some((entry) => (
    entry.many_collection === definition.collectionMany &&
    entry.many_field === definition.fieldMany &&
    entry.one_collection === definition.collectionOne
  ));

  if (existsAlready) {
    return;
  }

  const response = await fetch(`${baseUrl}/relations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      collection: definition.collectionMany,
      field: definition.fieldMany,
      related_collection: definition.collectionOne,
      schema: {
        table: definition.collectionMany,
        column: definition.fieldMany,
        foreign_key_table: definition.collectionOne,
        on_update: "NO ACTION",
        on_delete: "SET NULL",
      },
      meta: {
        many_collection: definition.collectionMany,
        many_field: definition.fieldMany,
        one_collection: definition.collectionOne,
        one_deselect_action: "nullify",
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create relation ${definition.collectionMany}.${definition.fieldMany} -> ${definition.collectionOne}:\n${await response.text()}`);
  }
}

async function createItem(collection, payload) {
  const response = await fetch(`${baseUrl}/items/${collection}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to create ${collection} seed record:\n${await response.text()}`);
  }

  const body = await response.json();
  return body.data;
}

async function requestJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${pathname}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function runSkeemJson(args, options) {
  const result = runCommand("node", [skeemBinPath, ...args, "--json"], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`skeem ${args[0]} failed:\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function runShellCommand(command, options) {
  return runCommand(process.env.SHELL || "zsh", ["-lc", command], {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
  });
}

function runCommand(command, args, options) {
  return spawnSync(command, args, {
    ...options,
    encoding: "utf8",
  });
}

async function stopExistingDirectus(child) {
  if (child?.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Fall through to pattern kills below.
    }
  }

  runCommand("pkill", ["-f", `${sharedProjectDir}/node_modules/.bin/directus start`], { cwd: repoRoot });
  runCommand("pkill", ["-f", "npm exec directus start"], { cwd: repoRoot });
  await sleep(1_000);
}

function stringField(name, options = {}) {
  return {
    field: name,
    type: "string",
    meta: {
      interface: "input",
      width: "full",
      ...(options.required ? { required: true } : {}),
    },
    schema: {
      name,
      data_type: "varchar",
      max_length: 255,
      is_nullable: options.required ? false : true,
      ...(options.unique ? { is_unique: true } : {}),
    },
  };
}

function integerField(name, options = {}) {
  return {
    field: name,
    type: "integer",
    meta: {
      interface: "input",
      width: "full",
      ...(options.required ? { required: true } : {}),
    },
    schema: {
      name,
      data_type: "integer",
      is_nullable: options.required ? false : true,
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

await main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
