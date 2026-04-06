# Eval Scaffold

This directory is the lightest useful scaffold for testing `skeem` with real LLMs.

It is intentionally small.

## What Lives Here

- `cases/`: task definitions for agent eval runs
- `transcripts/`: sample or captured model transcripts
- `providers/`: provider adapters and a sample command-backed provider
- `run.mjs`: tiny runner that boots the fixture, executes a transcript, verifies outcomes, and writes a result artifact

The current idea is to start manual or semi-automated:

1. boot a local Directus fixture
2. pick a case file
3. give the case prompt to a real model
4. execute only the `skeem` commands or `exec` plans the model proposes
5. score the result with deterministic checks

## Usage

Generate a prompt bundle and a pending result artifact:

```bash
npm run eval:run -- --case ./test/evals/cases/01-discovery-and-read.json
```

Run a case against a captured transcript:

```bash
npm run eval:run -- \
  --case ./test/evals/cases/01-discovery-and-read.json \
  --transcript ./test/evals/transcripts/01-discovery-and-read.sample.json
```

There is also a quick smoke-style sample run:

```bash
npm run eval:sample
```

Run a case through the command-backed provider loop:

```bash
npm run eval:provider:sample
```

Inspect Nano-GPT models and capabilities:

```bash
npm run eval:nano-gpt:models -- --limit 10
npm run eval:nano-gpt:models -- --model auto-model --json
```

Use your own command-backed provider:

```bash
npm run eval:run -- \
  --case ./test/evals/cases/01-discovery-and-read.json \
  --provider command \
  --provider-command 'node ./path/to/your-provider.mjs'
```

Use the built-in OpenAI provider:

```bash
OPENAI_API_KEY=... npm run eval:run -- \
  --case ./test/evals/cases/01-discovery-and-read.json \
  --provider openai \
  --model <responses-model>
```

Use the built-in Nano-GPT provider:

```bash
NANO_GPT_API_KEY=... npm run eval:run -- \
  --case ./test/evals/cases/01-discovery-and-read.json \
  --provider nano-gpt \
  --model <nano-gpt-model-id>
```

The runner writes result JSON files under [test/evals/results](/Users/brent/dev/skeem/test/evals/results) and keeps a per-run workspace under `test/.tmp/eval-harness/runs/`.

## Eval Principles

- prefer real backend state over mocked tool outputs
- keep cases short and legible
- verify outcomes, not prose quality
- start with five to eight cases, not fifty
- optimize for learning, not leaderboard theater

## Suggested Harness Rules

- the model may only propose `skeem` commands or JSON for `skeem exec`
- it should discover before mutating when uncertain
- writes should include `--json`
- retriable writes should include `--idempotency-key`
- shared-workflow tasks should include `--actor`

## Provider Contract

Providers produce one step at a time as JSON:

```json
{
  "type": "command",
  "command": "skeem ls --json"
}
```

or:

```json
{
  "type": "answer",
  "text": "Jane belongs to Acme."
}
```

For `skeem exec`, a provider can include a `stdin` field with the plan JSON instead of using shell redirection.

The command-backed provider receives a JSON payload on stdin containing:

- case metadata
- workspace directory
- generated artifacts such as schema files
- seed data
- current conversation messages
- prior execution history

See [test/evals/providers/sample-command-provider.mjs](/Users/brent/dev/skeem/test/evals/providers/sample-command-provider.mjs) for the smallest working example.

Nano-GPT-specific helpers:

- [test/evals/providers/nano-gpt.mjs](/Users/brent/dev/skeem/test/evals/providers/nano-gpt.mjs) for live eval runs
- [test/evals/providers/nano-gpt-models.mjs](/Users/brent/dev/skeem/test/evals/providers/nano-gpt-models.mjs) for listing models with `?detailed=true`

The Nano-GPT provider fetches model metadata up front and records capabilities like `structured_output`, `tool_calling`, `reasoning`, `context_length`, and pricing in the eval result.

## Next Implementation Step

Once a few manual runs exist, add a tiny runner that:

- loads a case file
- injects the operator prompt
- captures the transcript
- runs case-specific verification
- emits a result JSON file
