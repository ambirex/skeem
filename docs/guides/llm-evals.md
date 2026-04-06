# LLM Eval Plan

This guide is about testing `skeem` with real language models before we build a heavyweight benchmark stack.

The goal is not to prove that one model is "best." The goal is to learn whether `skeem`'s product assumptions are true in practice:

- do agents discover before mutating
- does the CLI grammar reduce tool-call count
- do stable JSON envelopes reduce recovery and parsing failures
- do idempotency, claims, and provenance actually help on retried or shared workflows
- is `exec` more helpful than risky for multi-step work

## High-Value Use Cases

These are the product-shaped jobs worth testing first.

## 1. Backend Orientation

The agent inherits an unfamiliar Directus project and needs to answer a question safely.

Example tasks:

- find which company a person belongs to
- identify which collections look user-managed versus system-managed
- export the current schema for review

Why it matters:

- this is the first thing an agent will do in the wild
- if discovery is weak, every write-oriented story gets shakier

## 2. Focused Operational Writes

The agent needs to create or update one record correctly.

Example tasks:

- create a company if it does not exist
- update a contact's status
- annotate a record with a handoff note

Why it matters:

- this is the simplest useful production path
- it tests basic command recall, field naming, and output handling

## 3. Relational Writes

The agent needs to attach or resolve related data without dropping into raw backend mechanics.

Example tasks:

- create a person and attach them to an existing company
- resolve a company by alias or unique field
- link and unlink many-to-many tags

Why it matters:

- this is where `skeem` should outperform naive CRUD wrappers
- it tests whether the grammar is actually easier for models to use

## 4. Retried And Recoverable Work

The agent needs to survive retries, partial failure, or a duplicated request.

Example tasks:

- retry a create with an idempotency key
- update a record after an interrupted run
- confirm whether a previous mutation already happened

Why it matters:

- this is one of the clearest "AI-native" advantages `skeem` can offer

## 5. Shared-Agent Coordination

Two runs or two agents may touch the same record.

Example tasks:

- claim a record before mutation
- detect an active claim and back off
- leave provenance or annotation breadcrumbs for the next agent

Why it matters:

- this tests whether our coordination layer is real product value or nice-sounding theory

## 6. Schema-As-Code Safety

The agent needs to inspect or propose schema changes without doing something reckless.

Example tasks:

- detect drift
- produce a dry-run define plan
- explain whether a proposed schema mutation is destructive

Why it matters:

- this is high-value, high-risk behavior
- it is exactly where agents benefit from explicit dry-run and diff primitives

## Assumptions To Test First

Keep the first round small. These assumptions are the most valuable:

1. Agents that are told to "discover first" succeed more often than agents dropped straight into a write task.
2. `skeem` commands plus stable JSON produce fewer invalid tool actions than raw backend API instructions.
3. Relation-aware operations reduce step count and failure rate for multi-entity tasks.
4. Idempotency and claims materially improve recoverability on repeated or shared workflows.
5. `exec` helps with structured multi-step plans, but may be worse than explicit commands for simple tasks.

## Minimal Rig

Start with a narrow, practical rig instead of a full benchmark harness.

## Scope

- one backend: local Directus
- one seeded fixture dataset
- five to eight eval cases
- one deterministic verifier per case
- one or two prompt styles per case
- manual or semi-automated transcript collection is acceptable at first

That is enough to learn whether the product is working for agents.

## Recommended Shape

Use three layers:

1. Fixture environment
2. Case definitions
3. Verifiers

### Fixture Environment

Reuse the existing Directus smoke setup as the base environment. It already proves that the CLI works end to end.

For evals, create a small, stable seed set:

- `companies`
- `people`
- `widgets`
- optional `labels` for many-to-many linking

The seed data should be human-readable and intentionally a little ambiguous, so the model has to inspect before acting.

### Case Definitions

Each case should be a small JSON document with:

- `id`
- `title`
- `category`
- `goal`
- `assumptions`
- `allowed_commands`
- `prompt`
- `success_checks`
- `failure_modes`

These files live in [test/evals/cases](/Users/brent/dev/skeem/test/evals/cases).

### Verifiers

Each case should have deterministic checks, ideally using real CLI calls:

- expected final record state
- expected number of created records
- expected presence or absence of claims
- expected provenance or annotation rows
- expected schema drift count

The verifier should not care about how elegant the transcript was. It should care whether the outcome is correct and safe.

## How To Run The First Round

The lightest useful process is:

1. Start the local fixture.
2. Pick one case file.
3. Give the model the case prompt plus a short operator prompt that says it may only propose `skeem` commands or `exec` plans.
4. Execute the proposed commands against the fixture.
5. Capture the transcript.
6. Run deterministic verification checks.
7. Score the outcome.

This is enough to test real behavior without building provider infrastructure first.

## Suggested Operator Prompt

Use a short, strict harness prompt like this:

```text
You are operating a relational CLI called skeem against a Directus backend.
Discover before mutating when the schema is uncertain.
Prefer skeem commands over guessing raw backend details.
Return only the next command to run, or a JSON exec plan when a multi-step plan is clearly warranted.
When a write may be retried, include --idempotency-key.
When coordination matters, include --actor and claims.
```

Then append the case prompt.

## Metrics That Matter

Keep scoring simple at the start.

- task success
- safe success
- wrong mutation count
- number of tool steps
- whether discovery was used before mutation
- recoverability after failure or retry
- schema hallucination rate
- need for human intervention

Do not start with token-optimization or fancy rubric scores. Those can come later.

## Recommended First Five Cases

- [01-discovery-and-read.json](/Users/brent/dev/skeem/test/evals/cases/01-discovery-and-read.json)
- [02-relational-create.json](/Users/brent/dev/skeem/test/evals/cases/02-relational-create.json)
- [03-retriable-update.json](/Users/brent/dev/skeem/test/evals/cases/03-retriable-update.json)
- [04-claim-and-annotate.json](/Users/brent/dev/skeem/test/evals/cases/04-claim-and-annotate.json)
- [05-schema-drift-review.json](/Users/brent/dev/skeem/test/evals/cases/05-schema-drift-review.json)

## What Not To Overbuild Yet

- a multi-provider benchmarking dashboard
- statistical significance tooling
- automatic ranking across dozens of models
- synthetic case generation
- complex judge models

The first job is just to learn whether real models can use `skeem` the way we hope.

## Likely Next Step

Once a few manual runs exist, the next logical step is a tiny scripted harness that:

- boots the fixture
- loads a case file
- records the transcript
- runs the verifier
- writes a result JSON artifact

That is the point where provider adapters start being worth the effort.

## Current Runner

The repo now includes a first-pass runner at [test/evals/run.mjs](/Users/brent/dev/skeem/test/evals/run.mjs).

It currently:

- boots a fresh Directus fixture
- seeds a stable eval dataset
- prepares a workspace with `.skeemrc.yaml`
- loads one case file
- writes a prompt bundle
- can either replay a saved transcript or drive a provider step by step
- runs a case-specific verifier
- writes a result JSON artifact

Useful entry points:

- [test/evals/README.md](/Users/brent/dev/skeem/test/evals/README.md)
- [test/evals/transcripts/01-discovery-and-read.sample.json](/Users/brent/dev/skeem/test/evals/transcripts/01-discovery-and-read.sample.json)
- [test/evals/providers/sample-command-provider.mjs](/Users/brent/dev/skeem/test/evals/providers/sample-command-provider.mjs)

Example:

```bash
npm run eval:run -- --case ./test/evals/cases/01-discovery-and-read.json
npm run eval:sample
npm run eval:provider:sample
```

Built-in provider modes now include:

- `command`: call any local command that returns one JSON step at a time
- `openai`: call the OpenAI Responses API directly when `OPENAI_API_KEY` is set
- `nano-gpt`: call Nano-GPT's OpenAI-compatible Responses API and capture model capabilities from `GET /api/v1/models?detailed=true`

The command provider is the easiest bridge to other real model CLIs, while the OpenAI and Nano-GPT paths are the smallest direct API integrations.

For Nano-GPT specifically, the repo now includes a helper to inspect model capabilities before choosing a model:

```bash
npm run eval:nano-gpt:models -- --limit 10
```

That is useful because Nano-GPT's detailed models endpoint exposes capabilities such as `structured_output`, `tool_calling`, `reasoning`, context length, and pricing. The eval provider stores that metadata in the run result so we can compare behavior by capability, not just by model name.
