#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixtureRoot = path.join(repoRoot, "test", ".tmp", "directus-smoke");
const projectDir = path.join(fixtureRoot, "project");
const databaseDir = path.join(projectDir, "database");
const uploadsDir = path.join(projectDir, "uploads");
const extensionsDir = path.join(projectDir, "extensions");
const discoverOutputPath = path.join(fixtureRoot, "widgets.skeem.yaml");
const diffInputPath = path.join(fixtureRoot, "schema-diff-input.skeem.yaml");
const defineInputPath = path.join(fixtureRoot, "schema-define-input.skeem.yaml");
const defineDestructivePath = path.join(fixtureRoot, "schema-define-destructive.skeem.yaml");
const configWorkspaceDir = path.join(fixtureRoot, "config-workspace");
const configNestedDir = path.join(configWorkspaceDir, "nested", "child");
const configPath = path.join(configWorkspaceDir, ".skeemrc.yaml");

const directusVersion = "11.17.1";
const sqliteVersion = "6.0.1";
const host = "127.0.0.1";
const port = 18055;
const baseUrl = `http://${host}:${port}`;
const adminEmail = "admin@example.com";
const adminPassword = "testpassword";
const adminToken = "skeem-admin-token";

let serverProcess;
let capturedStdout = "";
let capturedStderr = "";

try {
  await ensureFixtureProject();
  await stopExistingDirectus();
  await resetDatabase();
  await bootstrapDirectus();
  serverProcess = startDirectus();

  await waitForDirectus();
  await ensureCollection({
    name: "widgets",
    fields: [
      stringField("name"),
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
    ],
  });
  await ensureRelation({
    collectionMany: "people",
    fieldMany: "company_id",
    collectionOne: "companies",
  });
  await clearSkeemCache();
  await rm(discoverOutputPath, { force: true });
  await rm(diffInputPath, { force: true });
  await rm(defineInputPath, { force: true });
  await rm(defineDestructivePath, { force: true });

  const lsBefore = await runSkeemJson(["ls", "--counts"]);
  const widgetsBefore = expectCollection(lsBefore, "widgets");
  if (widgetsBefore.count !== 0) {
    throw new Error(`Expected widgets count to start at 0 but received ${widgetsBefore.count}.`);
  }

  const cache = await runSkeemJson(["cache", "show"]);
  if (!cache.ok || !cache.data?.exists) {
    throw new Error(`Expected schema cache to exist after ls:\n${JSON.stringify(cache, null, 2)}`);
  }

  const described = await runSkeemJson(["describe", "widgets"]);
  if (!described.ok || described.collection !== "widgets") {
    throw new Error(`Describe failed:\n${JSON.stringify(described, null, 2)}`);
  }
  if (!Array.isArray(described.data?.fields) || !described.data.fields.some((field) => field.name === "name")) {
    throw new Error(`Describe did not include the widgets.name field:\n${JSON.stringify(described, null, 2)}`);
  }

  const discovered = await runSkeemJson(["discover", "widgets"]);
  if (!discovered.ok || discovered.operation !== "discover") {
    throw new Error(`Discover failed:\n${JSON.stringify(discovered, null, 2)}`);
  }
  if (!discovered.data?.collections?.widgets?.fields?.name) {
    throw new Error(`Discover did not include the widgets.name field:\n${JSON.stringify(discovered, null, 2)}`);
  }

  const discoveredToFile = await runSkeemJson(["discover", "widgets", "-o", discoverOutputPath]);
  if (!discoveredToFile.ok || discoveredToFile.data?.path !== discoverOutputPath) {
    throw new Error(`Discover file output failed:\n${JSON.stringify(discoveredToFile, null, 2)}`);
  }

  const discoveredFileContents = await readFile(discoverOutputPath, "utf8");
  if (!discoveredFileContents.includes("collections:") || !discoveredFileContents.includes("widgets:")) {
    throw new Error(`Discover output file did not look like schema YAML:\n${discoveredFileContents}`);
  }

  const discoveredAll = await runSkeemJson(["discover"]);
  if (!discoveredAll.ok || !discoveredAll.data?.collections?.people || !discoveredAll.data?.collections?.companies) {
    throw new Error(`Discover all did not include the expected collections:\n${JSON.stringify(discoveredAll, null, 2)}`);
  }

  const diffInput = JSON.parse(JSON.stringify(discoveredAll.data));
  delete diffInput.collections.companies;
  diffInput.collections.widgets.fields.description = { type: "text" };
  diffInput.collections.widgets.fields.name.required = true;
  diffInput.collections.archived_widgets = {
    fields: {
      name: {
        type: "string",
        required: true,
      },
    },
  };
  await writeFile(diffInputPath, JSON.stringify(diffInput, null, 2));

  const diffDefine = await runSkeemJson(["diff", diffInputPath]);
  if (!diffDefine.ok || diffDefine.operation !== "diff" || diffDefine.data?.path !== diffInputPath) {
    throw new Error(`Diff (define) failed:\n${JSON.stringify(diffDefine, null, 2)}`);
  }
  if (!Array.isArray(diffDefine.data?.changes) || diffDefine.data.changes.length < 3) {
    throw new Error(`Diff (define) did not report enough changes:\n${JSON.stringify(diffDefine, null, 2)}`);
  }
  expectDiffChange(diffDefine, {
    scope: "collection",
    name: "companies",
    status: "only_in_live",
    resolution: "remove_from_live",
  });
  expectDiffChange(diffDefine, {
    scope: "collection",
    name: "archived_widgets",
    status: "only_in_file",
    resolution: "create_in_live",
  });
  expectDiffChange(diffDefine, {
    scope: "field",
    collection: "widgets",
    name: "name",
    status: "mismatch",
    resolution: "update_live",
  });
  if (!Array.isArray(diffDefine.data?.matches) || !diffDefine.data.matches.includes("people: match")) {
    throw new Error(`Diff (define) should record the untouched people collection as a match:\n${JSON.stringify(diffDefine, null, 2)}`);
  }

  const diffDiscover = await runSkeemJson(["diff", diffInputPath, "--direction", "discover"]);
  if (!diffDiscover.ok || diffDiscover.operation !== "diff") {
    throw new Error(`Diff (discover) failed:\n${JSON.stringify(diffDiscover, null, 2)}`);
  }
  expectDiffChange(diffDiscover, {
    scope: "collection",
    name: "companies",
    status: "only_in_live",
    resolution: "create_in_file",
  });
  expectDiffChange(diffDiscover, {
    scope: "collection",
    name: "archived_widgets",
    status: "only_in_file",
    resolution: "remove_from_file",
  });
  expectDiffChange(diffDiscover, {
    scope: "field",
    collection: "widgets",
    name: "name",
    status: "mismatch",
    resolution: "update_file",
  });

  const defineInput = JSON.parse(JSON.stringify(discoveredAll.data));
  defineInput.collections.projects = {
    fields: {
      code: {
        type: "string",
        unique: true,
      },
      name: {
        type: "string",
        required: true,
      },
    },
  };
  defineInput.collections.widgets.fields.description = { type: "text" };
  defineInput.collections.widgets.fields.project_id = { type: "integer" };
  defineInput.collections.widgets.fields.slug = {
    type: "string",
    unique: true,
  };
  defineInput.collections.widgets.relations = {
    ...(defineInput.collections.widgets.relations ?? {}),
    project_id: {
      collection: "projects",
      type: "m2o",
    },
  };
  defineInput.collections.labels = {
    fields: {
      name: {
        type: "string",
        required: true,
        unique: true,
      },
    },
  };
  defineInput.relations = [...(defineInput.relations ?? []), "widgets <-> labels"];
  await writeFile(defineInputPath, JSON.stringify(defineInput, null, 2));

  const defineDryRun = await runSkeemJson(["define", defineInputPath, "--dry-run"]);
  if (!defineDryRun.ok || defineDryRun.operation !== "dry_run" || defineDryRun.action !== "define") {
    throw new Error(`Define dry-run failed:\n${JSON.stringify(defineDryRun, null, 2)}`);
  }
  if (!Array.isArray(defineDryRun.plan) || defineDryRun.plan.length < 5) {
    throw new Error(`Define dry-run did not produce the expected plan:\n${JSON.stringify(defineDryRun, null, 2)}`);
  }
  expectPlanAction(defineDryRun, { action: "create_collection", collection: "projects" });
  expectPlanAction(defineDryRun, { action: "create_field", collection: "widgets", field: "description" });
  expectPlanAction(defineDryRun, { action: "create_field", collection: "widgets", field: "project_id" });
  expectPlanAction(defineDryRun, { action: "create_field", collection: "widgets", field: "slug" });
  expectPlanAction(defineDryRun, { action: "create_collection", collection: "labels" });
  expectPlanAction(defineDryRun, { action: "create_relation", collection: "widgets", field: "project_id" });
  expectPlanAction(defineDryRun, { action: "create_many_to_many_relation" });

  const defineApply = await runSkeemJson(["define", defineInputPath, "--yes"]);
  if (!defineApply.ok || defineApply.operation !== "define" || defineApply.action !== "define") {
    throw new Error(`Define apply failed:\n${JSON.stringify(defineApply, null, 2)}`);
  }
  if (defineApply.data?.summary?.applied !== 7 || defineApply.data?.summary?.skipped !== 0) {
    throw new Error(`Define apply summary was unexpected:\n${JSON.stringify(defineApply, null, 2)}`);
  }

  const diffAfterDefine = await runSkeemJson(["diff", defineInputPath]);
  if (!diffAfterDefine.ok || diffAfterDefine.data?.summary?.totalChanges !== 0) {
    throw new Error(`Define did not resolve schema drift:\n${JSON.stringify(diffAfterDefine, null, 2)}`);
  }

  const discoveredAfterDefine = await runSkeemJson(["discover"]);
  if (!discoveredAfterDefine.ok || !Array.isArray(discoveredAfterDefine.data?.relations) || !discoveredAfterDefine.data.relations.includes("labels <-> widgets")) {
    throw new Error(`Discover should surface the new many-to-many relation:\n${JSON.stringify(discoveredAfterDefine, null, 2)}`);
  }

  const lsAfterDefine = await runSkeemJson(["ls"]);
  if (!lsAfterDefine.ok || !Array.isArray(lsAfterDefine.data) || lsAfterDefine.data.some((entry) => entry.collection === "labels_widgets")) {
    throw new Error(`Junction collections should stay hidden from ls:\n${JSON.stringify(lsAfterDefine, null, 2)}`);
  }

  const initStatusBefore = await runSkeemJson(["init", "--status"]);
  if (
    !initStatusBefore.ok ||
    !Array.isArray(initStatusBefore.data) ||
    initStatusBefore.data.find((entry) => entry.collection === "skeem_aliases")?.exists !== false ||
    initStatusBefore.data.find((entry) => entry.collection === "skeem_provenance")?.exists !== false ||
    initStatusBefore.data.find((entry) => entry.collection === "skeem_versions")?.exists !== false ||
    initStatusBefore.data.find((entry) => entry.collection === "skeem_trash")?.exists !== false ||
    initStatusBefore.data.find((entry) => entry.collection === "skeem_claims")?.exists !== false ||
    initStatusBefore.data.find((entry) => entry.collection === "skeem_annotations")?.exists !== false
  ) {
    throw new Error(`Init status before apply was unexpected:\n${JSON.stringify(initStatusBefore, null, 2)}`);
  }

  const initApply = await runSkeemJson(["init"]);
  if (
    !initApply.ok ||
    initApply.operation !== "init" ||
    !Array.isArray(initApply.data?.applied) ||
    !initApply.data.applied.includes("skeem_aliases") ||
    !initApply.data.applied.includes("skeem_provenance") ||
    !initApply.data.applied.includes("skeem_versions") ||
    !initApply.data.applied.includes("skeem_trash") ||
    !initApply.data.applied.includes("skeem_claims") ||
    !initApply.data.applied.includes("skeem_annotations")
  ) {
    throw new Error(`Init apply failed:\n${JSON.stringify(initApply, null, 2)}`);
  }

  const initStatusAfter = await runSkeemJson(["init", "--status"]);
  if (
    !initStatusAfter.ok ||
    !Array.isArray(initStatusAfter.data) ||
    initStatusAfter.data.find((entry) => entry.collection === "skeem_aliases")?.exists !== true ||
    initStatusAfter.data.find((entry) => entry.collection === "skeem_provenance")?.exists !== true ||
    initStatusAfter.data.find((entry) => entry.collection === "skeem_versions")?.exists !== true ||
    initStatusAfter.data.find((entry) => entry.collection === "skeem_trash")?.exists !== true ||
    initStatusAfter.data.find((entry) => entry.collection === "skeem_claims")?.exists !== true ||
    initStatusAfter.data.find((entry) => entry.collection === "skeem_annotations")?.exists !== true
  ) {
    throw new Error(`Init status after apply was unexpected:\n${JSON.stringify(initStatusAfter, null, 2)}`);
  }

  const initAgain = await runSkeemJson(["init"]);
  if (!initAgain.ok || initAgain.action !== "noop" || initAgain.data?.applied?.length !== 0) {
    throw new Error(`Init should be idempotent on repeat runs:\n${JSON.stringify(initAgain, null, 2)}`);
  }

  const claimedCompany = await runSkeemJson(["create", "companies", "--name", "Claimed Co"]);
  const claimedCompanyId = claimedCompany.data?.id;
  if (!claimedCompany.ok || (typeof claimedCompanyId !== "number" && typeof claimedCompanyId !== "string")) {
    throw new Error(`Failed to create claim fixture company:\n${JSON.stringify(claimedCompany, null, 2)}`);
  }

  const claimAcquire = await runSkeemJson([
    "claim",
    `companies:${claimedCompanyId}`,
    "--actor",
    "assistant-claims-1",
    "--lease",
    "5m",
    "--purpose",
    "processing",
  ]);
  if (
    !claimAcquire.ok ||
    claimAcquire.operation !== "claim" ||
    claimAcquire.action !== "claimed" ||
    claimAcquire.data?.claim?.claimed_by !== "assistant-claims-1" ||
    claimAcquire.data?.claim?.purpose !== "processing"
  ) {
    throw new Error(`Claim acquire failed:\n${JSON.stringify(claimAcquire, null, 2)}`);
  }

  const claimStatus = await runSkeemJson(["claims", `companies:${claimedCompanyId}`]);
  if (
    !claimStatus.ok ||
    claimStatus.operation !== "claims" ||
    claimStatus.action !== "claimed" ||
    claimStatus.count !== 1 ||
    claimStatus.data?.claim?.claimed_by !== "assistant-claims-1"
  ) {
    throw new Error(`Claim status failed:\n${JSON.stringify(claimStatus, null, 2)}`);
  }

  const claimRows = await runSkeemJson(["find", "skeem_claims", "--where", "collection=companies"]);
  const activeClaim = expectClaimEntry(claimRows, {
    collection: "companies",
    recordId: claimedCompanyId,
  });
  if (
    activeClaim.claimed_by !== "assistant-claims-1" ||
    activeClaim.purpose !== "processing"
  ) {
    throw new Error(`Claim row was unexpected:\n${JSON.stringify(activeClaim, null, 2)}`);
  }

  const claimWrongRelease = await runSkeemJson([
    "release",
    `companies:${claimedCompanyId}`,
    "--actor",
    "assistant-claims-2",
  ], { expectFailure: true });
  if (
    claimWrongRelease.ok ||
    claimWrongRelease.error?.code !== "VALIDATION"
  ) {
    throw new Error(`Wrong-owner release should fail validation:\n${JSON.stringify(claimWrongRelease, null, 2)}`);
  }

  const claimRelease = await runSkeemJson([
    "release",
    `companies:${claimedCompanyId}`,
    "--actor",
    "assistant-claims-1",
  ]);
  if (
    !claimRelease.ok ||
    claimRelease.operation !== "release" ||
    claimRelease.action !== "released" ||
    claimRelease.data?.released !== 1
  ) {
    throw new Error(`Claim release failed:\n${JSON.stringify(claimRelease, null, 2)}`);
  }

  const claimStatusAfterRelease = await runSkeemJson(["claims", `companies:${claimedCompanyId}`]);
  if (
    !claimStatusAfterRelease.ok ||
    claimStatusAfterRelease.action !== "unclaimed" ||
    claimStatusAfterRelease.count !== 0 ||
    claimStatusAfterRelease.data?.claim !== null
  ) {
    throw new Error(`Claim should be gone after release:\n${JSON.stringify(claimStatusAfterRelease, null, 2)}`);
  }

  const claimExpiring = await runSkeemJson([
    "claim",
    `companies:${claimedCompanyId}`,
    "--actor",
    "assistant-expiring",
    "--lease",
    "1s",
  ]);
  if (!claimExpiring.ok || claimExpiring.action !== "claimed") {
    throw new Error(`Short claim fixture failed:\n${JSON.stringify(claimExpiring, null, 2)}`);
  }

  await sleep(1_200);

  const claimExpiredStatus = await runSkeemJson(["claims", `companies:${claimedCompanyId}`]);
  if (
    !claimExpiredStatus.ok ||
    claimExpiredStatus.action !== "unclaimed" ||
    claimExpiredStatus.count !== 0 ||
    claimExpiredStatus.data?.claim !== null
  ) {
    throw new Error(`Expired claim should not remain active:\n${JSON.stringify(claimExpiredStatus, null, 2)}`);
  }

  const claimAfterExpiry = await runSkeemJson([
    "claim",
    `companies:${claimedCompanyId}`,
    "--actor",
    "assistant-claims-3",
    "--lease",
    "5m",
    "--purpose",
    "reprocessing",
  ]);
  if (
    !claimAfterExpiry.ok ||
    claimAfterExpiry.action !== "claimed" ||
    claimAfterExpiry.data?.claim?.claimed_by !== "assistant-claims-3"
  ) {
    throw new Error(`Claim reacquire after expiry failed:\n${JSON.stringify(claimAfterExpiry, null, 2)}`);
  }

  const claimRowsAfterExpiry = await runSkeemJson(["find", "skeem_claims", "--where", "collection=companies"]);
  const activeClaimAfterExpiry = expectClaimEntry(claimRowsAfterExpiry, {
    collection: "companies",
    recordId: claimedCompanyId,
  });
  if (
    activeClaimAfterExpiry.claimed_by !== "assistant-claims-3" ||
    activeClaimAfterExpiry.purpose !== "reprocessing"
  ) {
    throw new Error(`Claim row after expiry cleanup was unexpected:\n${JSON.stringify(activeClaimAfterExpiry, null, 2)}`);
  }

  const claimFinalRelease = await runSkeemJson([
    "release",
    `companies:${claimedCompanyId}`,
    "--actor",
    "assistant-claims-3",
  ]);
  if (!claimFinalRelease.ok || claimFinalRelease.action !== "released") {
    throw new Error(`Final claim cleanup failed:\n${JSON.stringify(claimFinalRelease, null, 2)}`);
  }

  const annotateDryRun = await runSkeemJson([
    "annotate",
    `companies:${claimedCompanyId}`,
    "--key",
    "quality_score",
    "--value",
    "0.85",
    "--actor",
    "assistant-annotation",
    "--expires",
    "10m",
    "--dry-run",
  ]);
  if (
    !annotateDryRun.ok ||
    annotateDryRun.operation !== "dry_run" ||
    annotateDryRun.action !== "annotate" ||
    annotateDryRun.data?.annotation?.key !== "quality_score" ||
    annotateDryRun.data?.annotation?.value !== 0.85
  ) {
    throw new Error(`Annotate dry-run failed:\n${JSON.stringify(annotateDryRun, null, 2)}`);
  }

  const annotateWrite = await runSkeemJson([
    "annotate",
    `companies:${claimedCompanyId}`,
    "--key",
    "quality_score",
    "--value",
    "0.85",
    "--actor",
    "assistant-annotation",
    "--expires",
    "10m",
  ]);
  if (
    !annotateWrite.ok ||
    annotateWrite.operation !== "annotate" ||
    annotateWrite.action !== "annotated" ||
    annotateWrite.data?.annotation?.key !== "quality_score" ||
    annotateWrite.data?.annotation?.value !== 0.85 ||
    annotateWrite.data?.annotation?.actor !== "assistant-annotation" ||
    typeof annotateWrite.data?.annotation?.expires_at !== "string"
  ) {
    throw new Error(`Annotate write failed:\n${JSON.stringify(annotateWrite, null, 2)}`);
  }

  const annotateNote = await runSkeemJson([
    "annotate",
    `companies:${claimedCompanyId}`,
    "--key",
    "note",
    "--value",
    JSON.stringify("Email bounced 2026-03-15"),
    "--actor",
    "assistant-annotation-2",
  ]);
  if (
    !annotateNote.ok ||
    annotateNote.data?.annotation?.key !== "note" ||
    annotateNote.data?.annotation?.value !== "Email bounced 2026-03-15"
  ) {
    throw new Error(`String annotation write failed:\n${JSON.stringify(annotateNote, null, 2)}`);
  }

  const annotationRows = await runSkeemJson([
    "find",
    "skeem_annotations",
    "--where",
    "collection=companies",
  ]);
  const qualityScoreAnnotation = expectAnnotationEntry(annotationRows, {
    collection: "companies",
    recordId: claimedCompanyId,
    key: "quality_score",
  });
  if (
    qualityScoreAnnotation.value !== 0.85 ||
    qualityScoreAnnotation.actor !== "assistant-annotation" ||
    typeof qualityScoreAnnotation.expires_at !== "string"
  ) {
    throw new Error(`Quality-score annotation row was unexpected:\n${JSON.stringify(qualityScoreAnnotation, null, 2)}`);
  }

  const noteAnnotation = expectAnnotationEntry(annotationRows, {
    collection: "companies",
    recordId: claimedCompanyId,
    key: "note",
  });
  if (
    noteAnnotation.value !== "Email bounced 2026-03-15" ||
    noteAnnotation.actor !== "assistant-annotation-2"
  ) {
    throw new Error(`Note annotation row was unexpected:\n${JSON.stringify(noteAnnotation, null, 2)}`);
  }

  const idempotentCreate = await runSkeemJson([
    "create",
    "companies",
    "--name",
    "Idempotent Create Co",
    "--idempotency-key",
    "idem-create-1",
  ]);
  const idempotentCreateId = idempotentCreate.data?.id;
  if (!idempotentCreate.ok || (typeof idempotentCreateId !== "number" && typeof idempotentCreateId !== "string")) {
    throw new Error(`Idempotent create failed:\n${JSON.stringify(idempotentCreate, null, 2)}`);
  }

  const idempotentCreateReplay = await runSkeemJson([
    "create",
    "companies",
    "--name",
    "Idempotent Create Co",
    "--idempotency-key",
    "idem-create-1",
  ]);
  if (
    !idempotentCreateReplay.ok ||
    idempotentCreateReplay.operation !== "create" ||
    idempotentCreateReplay.data?.id !== idempotentCreateId
  ) {
    throw new Error(`Idempotent create replay failed:\n${JSON.stringify(idempotentCreateReplay, null, 2)}`);
  }

  const idempotentCreateRows = await runSkeemJson(["find", "companies", "--where", "name=Idempotent Create Co"]);
  if (!idempotentCreateRows.ok || idempotentCreateRows.count !== 1) {
    throw new Error(`Idempotent create should not create duplicates:\n${JSON.stringify(idempotentCreateRows, null, 2)}`);
  }

  const idempotentMismatch = await runSkeemJson([
    "create",
    "companies",
    "--name",
    "Different Idempotent Co",
    "--idempotency-key",
    "idem-create-1",
  ], { expectFailure: true });
  if (!idempotentMismatch.error || idempotentMismatch.error.code !== "VALIDATION") {
    throw new Error(`Idempotent mismatch should fail validation:\n${JSON.stringify(idempotentMismatch, null, 2)}`);
  }

  const idempotentUpdate = await runSkeemJson([
    "update",
    "companies",
    String(idempotentCreateId),
    "--industry",
    "Replay Safe",
    "--idempotency-key",
    "idem-update-1",
  ]);
  if (!idempotentUpdate.ok || idempotentUpdate.data?.industry !== "Replay Safe") {
    throw new Error(`Idempotent update failed:\n${JSON.stringify(idempotentUpdate, null, 2)}`);
  }

  const idempotentUpdateReplay = await runSkeemJson([
    "update",
    "companies",
    String(idempotentCreateId),
    "--industry",
    "Replay Safe",
    "--idempotency-key",
    "idem-update-1",
  ]);
  if (!idempotentUpdateReplay.ok || idempotentUpdateReplay.data?.industry !== "Replay Safe") {
    throw new Error(`Idempotent update replay failed:\n${JSON.stringify(idempotentUpdateReplay, null, 2)}`);
  }

  const idempotentUpdateVersions = await runSkeemJson([
    "find",
    "skeem_versions",
    "--where",
    "collection=companies",
    "--where",
    `record_id=${idempotentCreateId}`,
  ]);
  if (!idempotentUpdateVersions.ok || idempotentUpdateVersions.count !== 1) {
    throw new Error(`Idempotent update replay should not create extra version rows:\n${JSON.stringify(idempotentUpdateVersions, null, 2)}`);
  }

  const idempotentUpsert = await runSkeemJson([
    "upsert",
    "companies",
    "--match",
    "name=Idempotent Upsert Co",
    "--industry",
    "Services",
    "--idempotency-key",
    "idem-upsert-1",
  ]);
  const idempotentUpsertId = idempotentUpsert.data?.id;
  if (
    !idempotentUpsert.ok ||
    idempotentUpsert.action !== "created" ||
    (typeof idempotentUpsertId !== "number" && typeof idempotentUpsertId !== "string")
  ) {
    throw new Error(`Idempotent upsert failed:\n${JSON.stringify(idempotentUpsert, null, 2)}`);
  }

  const idempotentUpsertReplay = await runSkeemJson([
    "upsert",
    "companies",
    "--match",
    "name=Idempotent Upsert Co",
    "--industry",
    "Services",
    "--idempotency-key",
    "idem-upsert-1",
  ]);
  if (
    !idempotentUpsertReplay.ok ||
    idempotentUpsertReplay.action !== "created" ||
    idempotentUpsertReplay.data?.id !== idempotentUpsertId
  ) {
    throw new Error(`Idempotent upsert replay failed:\n${JSON.stringify(idempotentUpsertReplay, null, 2)}`);
  }

  const idempotentUpsertRows = await runSkeemJson(["find", "companies", "--where", "name=Idempotent Upsert Co"]);
  if (!idempotentUpsertRows.ok || idempotentUpsertRows.count !== 1) {
    throw new Error(`Idempotent upsert should not create duplicates:\n${JSON.stringify(idempotentUpsertRows, null, 2)}`);
  }

  const idempotentDeleteWidget = await runSkeemJson(["create", "widgets", "--name", "Idempotent Widget"]);
  const idempotentDeleteWidgetId = idempotentDeleteWidget.data?.id;
  if (!idempotentDeleteWidget.ok || (typeof idempotentDeleteWidgetId !== "number" && typeof idempotentDeleteWidgetId !== "string")) {
    throw new Error(`Failed to create idempotent delete fixture widget:\n${JSON.stringify(idempotentDeleteWidget, null, 2)}`);
  }

  const idempotentDelete = await runSkeemJson([
    "delete",
    "widgets",
    String(idempotentDeleteWidgetId),
    "--idempotency-key",
    "idem-delete-1",
  ]);
  if (!idempotentDelete.ok || idempotentDelete.action !== "trashed" || idempotentDelete.data?.id !== idempotentDeleteWidgetId) {
    throw new Error(`Idempotent delete failed:\n${JSON.stringify(idempotentDelete, null, 2)}`);
  }

  const idempotentDeleteReplay = await runSkeemJson([
    "delete",
    "widgets",
    String(idempotentDeleteWidgetId),
    "--idempotency-key",
    "idem-delete-1",
  ]);
  if (
    !idempotentDeleteReplay.ok ||
    idempotentDeleteReplay.action !== "trashed" ||
    idempotentDeleteReplay.data?.trashId !== idempotentDelete.data?.trashId
  ) {
    throw new Error(`Idempotent delete replay failed:\n${JSON.stringify(idempotentDeleteReplay, null, 2)}`);
  }

  const idempotentDeleteTrash = await runSkeemJson([
    "find",
    "skeem_trash",
    "--where",
    "collection=widgets",
  ]);
  const idempotentDeleteTrashRow = expectTrashEntry(idempotentDeleteTrash, {
    collection: "widgets",
    recordId: idempotentDeleteWidgetId,
  });
  if (idempotentDeleteTrashRow.snapshot?.name !== "Idempotent Widget") {
    throw new Error(`Idempotent delete trash row was unexpected:\n${JSON.stringify(idempotentDeleteTrashRow, null, 2)}`);
  }

  const idempotentPerson = await runSkeemJson(["create", "people", "--name", "Idempotent Linker"]);
  const idempotentPersonId = idempotentPerson.data?.id;
  if (!idempotentPerson.ok || (typeof idempotentPersonId !== "number" && typeof idempotentPersonId !== "string")) {
    throw new Error(`Failed to create idempotent link fixture person:\n${JSON.stringify(idempotentPerson, null, 2)}`);
  }

  const idempotentLink = await runSkeemJson([
    "link",
    `people:${idempotentPersonId}`,
    `companies:${idempotentCreateId}`,
    "--idempotency-key",
    "idem-link-1",
  ]);
  if (!idempotentLink.ok || idempotentLink.action !== "linked" || idempotentLink.data?.record?.company_id !== idempotentCreateId) {
    throw new Error(`Idempotent link failed:\n${JSON.stringify(idempotentLink, null, 2)}`);
  }

  const idempotentLinkReplay = await runSkeemJson([
    "link",
    `people:${idempotentPersonId}`,
    `companies:${idempotentCreateId}`,
    "--idempotency-key",
    "idem-link-1",
  ]);
  if (!idempotentLinkReplay.ok || idempotentLinkReplay.action !== "linked" || idempotentLinkReplay.data?.record?.company_id !== idempotentCreateId) {
    throw new Error(`Idempotent link replay failed:\n${JSON.stringify(idempotentLinkReplay, null, 2)}`);
  }

  const idempotentUnlink = await runSkeemJson([
    "unlink",
    `people:${idempotentPersonId}`,
    `companies:${idempotentCreateId}`,
    "--idempotency-key",
    "idem-unlink-1",
  ]);
  if (!idempotentUnlink.ok || idempotentUnlink.action !== "unlinked") {
    throw new Error(`Idempotent unlink failed:\n${JSON.stringify(idempotentUnlink, null, 2)}`);
  }

  const idempotentUnlinkReplay = await runSkeemJson([
    "unlink",
    `people:${idempotentPersonId}`,
    `companies:${idempotentCreateId}`,
    "--idempotency-key",
    "idem-unlink-1",
  ]);
  if (!idempotentUnlinkReplay.ok || idempotentUnlinkReplay.action !== "unlinked" || idempotentUnlinkReplay.data?.record?.company_id !== null) {
    throw new Error(`Idempotent unlink replay failed:\n${JSON.stringify(idempotentUnlinkReplay, null, 2)}`);
  }

  const idempotentAnnotate = await runSkeemJson([
    "annotate",
    `companies:${idempotentCreateId}`,
    "--key",
    "idempotent_note",
    "--value",
    JSON.stringify("Replay me once"),
    "--idempotency-key",
    "idem-annotate-1",
  ]);
  if (!idempotentAnnotate.ok || idempotentAnnotate.data?.annotation?.key !== "idempotent_note") {
    throw new Error(`Idempotent annotate failed:\n${JSON.stringify(idempotentAnnotate, null, 2)}`);
  }

  const idempotentAnnotateReplay = await runSkeemJson([
    "annotate",
    `companies:${idempotentCreateId}`,
    "--key",
    "idempotent_note",
    "--value",
    JSON.stringify("Replay me once"),
    "--idempotency-key",
    "idem-annotate-1",
  ]);
  if (!idempotentAnnotateReplay.ok || idempotentAnnotateReplay.data?.annotation?.key !== "idempotent_note") {
    throw new Error(`Idempotent annotate replay failed:\n${JSON.stringify(idempotentAnnotateReplay, null, 2)}`);
  }

  const idempotentAnnotationRows = await runSkeemJson([
    "find",
    "skeem_annotations",
    "--where",
    "collection=companies",
  ]);
  const idempotentAnnotation = expectAnnotationEntry(idempotentAnnotationRows, {
    collection: "companies",
    recordId: idempotentCreateId,
    key: "idempotent_note",
  });
  if (idempotentAnnotation.value !== "Replay me once") {
    throw new Error(`Idempotent annotation row was unexpected:\n${JSON.stringify(idempotentAnnotation, null, 2)}`);
  }

  const provenanceCompany = await runSkeemJson([
    "create",
    "companies",
    "--name",
    "Provenance Co",
    "--actor",
    "assistant-provenance",
    "--context",
    "{\"task\":\"create\"}",
    "--idempotency-key",
    "prov-create-1",
  ]);
  const provenanceCompanyId = provenanceCompany.data?.id;
  if (!provenanceCompany.ok || (typeof provenanceCompanyId !== "number" && typeof provenanceCompanyId !== "string")) {
    throw new Error(`Failed to create provenance fixture company:\n${JSON.stringify(provenanceCompany, null, 2)}`);
  }

  const provenanceCreateRows = await runSkeemJson(["find", "skeem_provenance", "--where", "collection=companies", "--where", "operation=create"]);
  const provenanceCreateRow = expectProvenanceEntry(provenanceCreateRows, {
    collection: "companies",
    recordId: provenanceCompanyId,
    operation: "create",
  });
  if (
    provenanceCreateRow.actor !== "assistant-provenance" ||
    provenanceCreateRow.actor_type !== "agent" ||
    provenanceCreateRow.context?.task !== "create" ||
    provenanceCreateRow.idempotency_key !== "prov-create-1" ||
    provenanceCreateRow.input_refs?.fields?.name !== "Provenance Co"
  ) {
    throw new Error(`Create provenance row was unexpected:\n${JSON.stringify(provenanceCreateRow, null, 2)}`);
  }

  const provenanceUpsert = await runSkeemJson([
    "upsert",
    "companies",
    "--match",
    "name=Provenance Co",
    "--industry",
    "Audit",
    "--actor",
    "assistant-provenance",
    "--context",
    "{\"task\":\"upsert\"}",
    "--idempotency-key",
    "prov-upsert-1",
  ]);
  if (!provenanceUpsert.ok || provenanceUpsert.action !== "updated" || provenanceUpsert.data?.id !== provenanceCompanyId) {
    throw new Error(`Provenance upsert fixture failed:\n${JSON.stringify(provenanceUpsert, null, 2)}`);
  }

  const provenanceUpsertRows = await runSkeemJson(["find", "skeem_provenance", "--where", "collection=companies", "--where", "operation=upsert"]);
  const provenanceUpsertRow = expectProvenanceEntry(provenanceUpsertRows, {
    collection: "companies",
    recordId: provenanceCompanyId,
    operation: "upsert",
  });
  if (
    provenanceUpsertRow.context?.task !== "upsert" ||
    provenanceUpsertRow.idempotency_key !== "prov-upsert-1" ||
    provenanceUpsertRow.input_refs?.action !== "updated" ||
    provenanceUpsertRow.input_refs?.match?.name !== "Provenance Co"
  ) {
    throw new Error(`Upsert provenance row was unexpected:\n${JSON.stringify(provenanceUpsertRow, null, 2)}`);
  }

  const provenancePerson = await runSkeemJson([
    "create",
    "people",
    "--name",
    "Provenance Pat",
    "--actor",
    "assistant-provenance",
    "--context",
    "{\"task\":\"person-create\"}",
  ]);
  const provenancePersonId = provenancePerson.data?.id;
  if (!provenancePerson.ok || (typeof provenancePersonId !== "number" && typeof provenancePersonId !== "string")) {
    throw new Error(`Failed to create provenance fixture person:\n${JSON.stringify(provenancePerson, null, 2)}`);
  }

  const provenanceLink = await runSkeemJson([
    "link",
    `people:${provenancePersonId}`,
    "company",
    "?name=Provenance Co",
    "--actor",
    "assistant-provenance",
    "--context",
    "{\"task\":\"link\"}",
  ]);
  if (!provenanceLink.ok || provenanceLink.action !== "linked") {
    throw new Error(`Provenance link fixture failed:\n${JSON.stringify(provenanceLink, null, 2)}`);
  }

  const provenanceLinkRows = await runSkeemJson(["find", "skeem_provenance", "--where", "collection=people", "--where", "operation=link"]);
  const provenanceLinkRow = expectProvenanceEntry(provenanceLinkRows, {
    collection: "people",
    recordId: provenancePersonId,
    operation: "link",
  });
  if (
    provenanceLinkRow.context?.task !== "link" ||
    provenanceLinkRow.input_refs?.relation !== "company_id" ||
    provenanceLinkRow.input_refs?.target?.filter?.name !== "Provenance Co"
  ) {
    throw new Error(`Link provenance row was unexpected:\n${JSON.stringify(provenanceLinkRow, null, 2)}`);
  }

  const provenanceUnlink = await runSkeemJson([
    "unlink",
    `people:${provenancePersonId}`,
    "company",
    `companies:${provenanceCompanyId}`,
    "--actor",
    "assistant-provenance",
    "--context",
    "{\"task\":\"unlink\"}",
  ]);
  if (!provenanceUnlink.ok || provenanceUnlink.action !== "unlinked") {
    throw new Error(`Provenance unlink fixture failed:\n${JSON.stringify(provenanceUnlink, null, 2)}`);
  }

  const provenanceUnlinkRows = await runSkeemJson(["find", "skeem_provenance", "--where", "collection=people", "--where", "operation=unlink"]);
  const provenanceUnlinkRow = expectProvenanceEntry(provenanceUnlinkRows, {
    collection: "people",
    recordId: provenancePersonId,
    operation: "unlink",
  });
  if (
    provenanceUnlinkRow.context?.task !== "unlink" ||
    provenanceUnlinkRow.input_refs?.target?.id !== provenanceCompanyId
  ) {
    throw new Error(`Unlink provenance row was unexpected:\n${JSON.stringify(provenanceUnlinkRow, null, 2)}`);
  }

  const provenanceDelete = await runSkeemJson([
    "delete",
    "people",
    String(provenancePersonId),
    "--actor",
    "assistant-provenance",
    "--context",
    "{\"task\":\"delete\"}",
    "--idempotency-key",
    "prov-delete-1",
  ]);
  if (!provenanceDelete.ok || provenanceDelete.operation !== "delete") {
    throw new Error(`Provenance delete fixture failed:\n${JSON.stringify(provenanceDelete, null, 2)}`);
  }

  const provenanceDeleteRows = await runSkeemJson(["find", "skeem_provenance", "--where", "collection=people", "--where", "operation=delete"]);
  const provenanceDeleteRow = expectProvenanceEntry(provenanceDeleteRows, {
    collection: "people",
    recordId: provenancePersonId,
    operation: "delete",
  });
  if (
    provenanceDeleteRow.context?.task !== "delete" ||
    provenanceDeleteRow.idempotency_key !== "prov-delete-1"
  ) {
    throw new Error(`Delete provenance row was unexpected:\n${JSON.stringify(provenanceDeleteRow, null, 2)}`);
  }

  const versionedCompany = await runSkeemJson(["create", "companies", "--name", "Versioned Co", "--industry", "Seed"]);
  const versionedCompanyId = versionedCompany.data?.id;
  if (!versionedCompany.ok || (typeof versionedCompanyId !== "number" && typeof versionedCompanyId !== "string")) {
    throw new Error(`Failed to create version fixture company:\n${JSON.stringify(versionedCompany, null, 2)}`);
  }

  const versionedUpdate = await runSkeemJson([
    "update",
    "companies",
    String(versionedCompanyId),
    "--industry",
    "Series A",
    "--actor",
    "assistant-version",
    "--context",
    "{\"task\":\"version-update\"}",
  ]);
  if (!versionedUpdate.ok || versionedUpdate.data?.industry !== "Series A") {
    throw new Error(`Version fixture update failed:\n${JSON.stringify(versionedUpdate, null, 2)}`);
  }

  const versionedUpsert = await runSkeemJson([
    "upsert",
    "companies",
    "--match",
    "name=Versioned Co",
    "--industry",
    "Series B",
    "--actor",
    "assistant-version",
    "--context",
    "{\"task\":\"version-upsert\"}",
  ]);
  if (!versionedUpsert.ok || versionedUpsert.action !== "updated" || versionedUpsert.data?.industry !== "Series B") {
    throw new Error(`Version fixture upsert failed:\n${JSON.stringify(versionedUpsert, null, 2)}`);
  }

  const versionRows = await runSkeemJson(["find", "skeem_versions", "--where", "collection=companies", "--sort", "-version"]);
  const versionHistory = expectVersionEntries(versionRows, {
    collection: "companies",
    recordId: versionedCompanyId,
    count: 2,
  });
  if (
    versionHistory[0]?.version !== 2 ||
    versionHistory[0]?.snapshot?.industry !== "Series A" ||
    !Array.isArray(versionHistory[0]?.changed_fields) ||
    !versionHistory[0].changed_fields.includes("industry") ||
    (typeof versionHistory[0]?.provenance_id !== "number" && typeof versionHistory[0]?.provenance_id !== "string")
  ) {
    throw new Error(`Latest version row was unexpected:\n${JSON.stringify(versionHistory, null, 2)}`);
  }
  if (
    versionHistory[1]?.version !== 1 ||
    versionHistory[1]?.snapshot?.industry !== "Seed" ||
    !Array.isArray(versionHistory[1]?.changed_fields) ||
    !versionHistory[1].changed_fields.includes("industry") ||
    versionHistory[1]?.snapshot?.name !== "Versioned Co"
  ) {
    throw new Error(`Initial version row was unexpected:\n${JSON.stringify(versionHistory, null, 2)}`);
  }

  const upsertCompanyCreate = await runSkeemJson(["upsert", "companies", "--match", "name=Upsert Co", "--industry", "Services"]);
  const upsertCompanyId = upsertCompanyCreate.data?.id;
  if (!upsertCompanyCreate.ok || upsertCompanyCreate.action !== "created" || upsertCompanyCreate.data?.industry !== "Services") {
    throw new Error(`Upsert create failed:\n${JSON.stringify(upsertCompanyCreate, null, 2)}`);
  }

  const upsertCompanyUpdate = await runSkeemJson(["upsert", "companies", "--match", "name=Upsert Co", "--industry", "Consulting"]);
  if (!upsertCompanyUpdate.ok || upsertCompanyUpdate.action !== "updated" || upsertCompanyUpdate.data?.id !== upsertCompanyId || upsertCompanyUpdate.data?.industry !== "Consulting") {
    throw new Error(`Upsert update failed:\n${JSON.stringify(upsertCompanyUpdate, null, 2)}`);
  }

  const upsertLabel = await runSkeemJson(["upsert", "labels", "--match", "name=Urgent"]);
  const urgentLabelId = upsertLabel.data?.id;
  if (!upsertLabel.ok || (typeof urgentLabelId !== "number" && typeof urgentLabelId !== "string")) {
    throw new Error(`Failed to create link label via upsert:\n${JSON.stringify(upsertLabel, null, 2)}`);
  }

  const upsertWidget = await runSkeemJson(["upsert", "widgets", "--match", "slug=linkable-widget", "--name", "Linkable Widget"]);
  const linkableWidgetId = upsertWidget.data?.id;
  if (!upsertWidget.ok || upsertWidget.action !== "created" || (typeof linkableWidgetId !== "number" && typeof linkableWidgetId !== "string")) {
    throw new Error(`Failed to create linkable widget via upsert:\n${JSON.stringify(upsertWidget, null, 2)}`);
  }

  const m2mLinkDryRun = await runSkeemJson(["link", `widgets:${linkableWidgetId}`, "labels", "?name=Urgent", "--dry-run"]);
  if (!m2mLinkDryRun.ok || m2mLinkDryRun.operation !== "dry_run" || m2mLinkDryRun.action !== "link") {
    throw new Error(`M2M link dry-run failed:\n${JSON.stringify(m2mLinkDryRun, null, 2)}`);
  }

  const m2mLink = await runSkeemJson(["link", `widgets:${linkableWidgetId}`, "labels", "?name=Urgent"]);
  if (!m2mLink.ok || m2mLink.operation !== "link" || m2mLink.action !== "linked") {
    throw new Error(`M2M link failed:\n${JSON.stringify(m2mLink, null, 2)}`);
  }

  const linkedRows = await requestJson(`/items/labels_widgets?filter[widgets_id][_eq]=${linkableWidgetId}&filter[labels_id][_eq]=${urgentLabelId}`);
  if (!Array.isArray(linkedRows.data) || linkedRows.data.length !== 1) {
    throw new Error(`Expected one junction row after M2M link:\n${JSON.stringify(linkedRows, null, 2)}`);
  }

  const m2mLinkAgain = await runSkeemJson(["link", `widgets:${linkableWidgetId}`, `labels:${urgentLabelId}`]);
  if (!m2mLinkAgain.ok || m2mLinkAgain.action !== "already_linked") {
    throw new Error(`Repeated M2M link should be idempotent:\n${JSON.stringify(m2mLinkAgain, null, 2)}`);
  }

  const m2mUnlink = await runSkeemJson(["unlink", `widgets:${linkableWidgetId}`, `labels:${urgentLabelId}`]);
  if (!m2mUnlink.ok || m2mUnlink.operation !== "unlink" || m2mUnlink.action !== "unlinked" || m2mUnlink.data?.removed !== 1) {
    throw new Error(`M2M unlink failed:\n${JSON.stringify(m2mUnlink, null, 2)}`);
  }

  const linkedRowsAfterUnlink = await requestJson(`/items/labels_widgets?filter[widgets_id][_eq]=${linkableWidgetId}&filter[labels_id][_eq]=${urgentLabelId}`);
  if (!Array.isArray(linkedRowsAfterUnlink.data) || linkedRowsAfterUnlink.data.length !== 0) {
    throw new Error(`Expected junction row cleanup after M2M unlink:\n${JSON.stringify(linkedRowsAfterUnlink, null, 2)}`);
  }

  const deleteLinkableWidget = await runSkeemJson(["delete", "widgets", String(linkableWidgetId)]);
  if (!deleteLinkableWidget.ok) {
    throw new Error(`Failed to clean up linkable widget:\n${JSON.stringify(deleteLinkableWidget, null, 2)}`);
  }

  const defineDestructive = JSON.parse(JSON.stringify(defineInput));
  delete defineDestructive.collections.labels;
  delete defineDestructive.collections.widgets.fields.description;
  defineDestructive.relations = [];
  await writeFile(defineDestructivePath, JSON.stringify(defineDestructive, null, 2));

  const defineDestructiveSkip = await runSkeemJson(["define", defineDestructivePath, "--yes"]);
  if (!defineDestructiveSkip.ok || defineDestructiveSkip.data?.summary?.applied !== 0 || defineDestructiveSkip.data?.summary?.skipped < 3) {
    throw new Error(`Destructive define should skip changes without --allow-destructive:\n${JSON.stringify(defineDestructiveSkip, null, 2)}`);
  }
  expectPlanAction(defineDestructiveSkip, { action: "remove_many_to_many_relation" });
  expectPlanAction(defineDestructiveSkip, { action: "remove_field", collection: "widgets", field: "description" });
  expectPlanAction(defineDestructiveSkip, { action: "remove_collection", collection: "labels" });

  const diffAfterSkippedDestructive = await runSkeemJson(["diff", defineDestructivePath]);
  if (!diffAfterSkippedDestructive.ok || diffAfterSkippedDestructive.data?.summary?.totalChanges < 3) {
    throw new Error(`Skipping destructive define should leave drift behind:\n${JSON.stringify(diffAfterSkippedDestructive, null, 2)}`);
  }

  const defineDestructiveApply = await runSkeemJson(["define", defineDestructivePath, "--yes", "--allow-destructive"]);
  if (!defineDestructiveApply.ok || defineDestructiveApply.data?.summary?.applied < 3 || defineDestructiveApply.data?.summary?.skipped !== 0) {
    throw new Error(`Destructive define apply failed:\n${JSON.stringify(defineDestructiveApply, null, 2)}`);
  }

  const diffAfterDestructive = await runSkeemJson(["diff", defineDestructivePath]);
  if (!diffAfterDestructive.ok || diffAfterDestructive.data?.summary?.totalChanges !== 0) {
    throw new Error(`Destructive define should resolve drift:\n${JSON.stringify(diffAfterDestructive, null, 2)}`);
  }

  const dryRun = await runSkeemJson(["create", "people", "--name", "Dry Run", "--company.name", "Dry Run Co", "--dry-run"]);
  if (!dryRun.ok || dryRun.operation !== "dry_run" || !Array.isArray(dryRun.plan) || dryRun.plan.length !== 2) {
    throw new Error(`Dry-run relation preview failed:\n${JSON.stringify(dryRun, null, 2)}`);
  }
  if (dryRun.plan[0]?.collection !== "companies" || dryRun.plan[1]?.collection !== "people") {
    throw new Error(`Dry-run plan order was unexpected:\n${JSON.stringify(dryRun, null, 2)}`);
  }
  if (dryRun.plan[1]?.data?.company_id !== "$root_company.id") {
    throw new Error(`Dry-run root plan did not include relation placeholder:\n${JSON.stringify(dryRun, null, 2)}`);
  }

  const created = await runSkeemJson(["create", "widgets", "--name", "Alpha Widget"]);
  if (!created.ok || created.operation !== "create") {
    throw new Error(`Create failed:\n${JSON.stringify(created, null, 2)}`);
  }

  const widgetId = created.data?.id;
  if (typeof widgetId !== "number" && typeof widgetId !== "string") {
    throw new Error(`Create response did not include a usable id:\n${JSON.stringify(created, null, 2)}`);
  }

  const got = await runSkeemJson(["get", "widgets", String(widgetId)]);
  if (!got.ok || got.data?.name !== "Alpha Widget") {
    throw new Error(`Get failed or returned unexpected data:\n${JSON.stringify(got, null, 2)}`);
  }

  const found = await runSkeemJson(["find", "widgets", "--where", "name=Alpha Widget"]);
  if (!found.ok || found.count !== 1) {
    throw new Error(`Find failed or returned unexpected count:\n${JSON.stringify(found, null, 2)}`);
  }

  const updated = await runSkeemJson(["update", "widgets", String(widgetId), "--name", "Beta Widget"]);
  if (!updated.ok || updated.data?.name !== "Beta Widget") {
    throw new Error(`Update failed or returned unexpected data:\n${JSON.stringify(updated, null, 2)}`);
  }

  const foundUpdated = await runSkeemJson(["find", "widgets", "--where", "name=Beta Widget"]);
  if (!foundUpdated.ok || foundUpdated.count !== 1) {
    throw new Error(`Updated record was not discoverable:\n${JSON.stringify(foundUpdated, null, 2)}`);
  }

  const deleted = await runSkeemJson(["delete", "widgets", String(widgetId)]);
  if (!deleted.ok || deleted.operation !== "delete" || deleted.action !== "trashed") {
    throw new Error(`Delete failed:\n${JSON.stringify(deleted, null, 2)}`);
  }

  const getAfterDelete = await runSkeemJson(["get", "widgets", String(widgetId)], { expectFailure: true });
  if (getAfterDelete.ok) {
    throw new Error(`Expected get to fail after delete:\n${JSON.stringify(getAfterDelete, null, 2)}`);
  }

  const findAfterDelete = await runSkeemJson(["find", "widgets", "--where", `id=${widgetId}`]);
  if (!findAfterDelete.ok || findAfterDelete.count !== 0) {
    throw new Error(`Expected deleted record to disappear from find results:\n${JSON.stringify(findAfterDelete, null, 2)}`);
  }

  const trashRows = await runSkeemJson(["find", "skeem_trash", "--where", "collection=widgets"]);
  const trashRow = expectTrashEntry(trashRows, {
    collection: "widgets",
    recordId: widgetId,
  });
  if (
    trashRow.snapshot?.id !== widgetId ||
    trashRow.snapshot?.name !== "Beta Widget" ||
    (typeof trashRow.provenance_id !== "number" && typeof trashRow.provenance_id !== "string")
  ) {
    throw new Error(`Trash row was unexpected after soft delete:\n${JSON.stringify(trashRow, null, 2)}`);
  }

  const restoreDryRun = await runSkeemJson(["restore", "widgets", String(widgetId), "--dry-run"]);
  if (!restoreDryRun.ok || restoreDryRun.operation !== "dry_run" || restoreDryRun.action !== "restore") {
    throw new Error(`Restore dry-run failed:\n${JSON.stringify(restoreDryRun, null, 2)}`);
  }

  const restored = await runSkeemJson(["restore", "widgets", String(widgetId)]);
  if (!restored.ok || restored.operation !== "restore" || !["restored", "restored_with_residual_trash"].includes(restored.action ?? "")) {
    throw new Error(`Restore failed:\n${JSON.stringify(restored, null, 2)}`);
  }

  const restoredGet = await runSkeemJson(["get", "widgets", String(widgetId)]);
  if (!restoredGet.ok || restoredGet.data?.name !== "Beta Widget") {
    throw new Error(`Restored record was not readable:\n${JSON.stringify(restoredGet, null, 2)}`);
  }

  const trashRowsAfterRestore = await runSkeemJson(["find", "skeem_trash", "--where", "collection=widgets"]);
  if (!trashRowsAfterRestore.ok || trashRowsAfterRestore.data?.some((entry) => String(entry.record_id) === String(widgetId))) {
    throw new Error(`Restore should remove the trash entry:\n${JSON.stringify(trashRowsAfterRestore, null, 2)}`);
  }

  const hardDeleted = await runSkeemJson(["delete", "widgets", String(widgetId), "--hard"]);
  if (!hardDeleted.ok || hardDeleted.operation !== "delete" || hardDeleted.action !== "hard_deleted" || hardDeleted.data?.trashed !== false) {
    throw new Error(`Hard delete failed:\n${JSON.stringify(hardDeleted, null, 2)}`);
  }

  const hardDeleteTrashRows = await runSkeemJson(["find", "skeem_trash", "--where", "collection=widgets"]);
  if (!hardDeleteTrashRows.ok || hardDeleteTrashRows.data?.some((entry) => String(entry.record_id) === String(widgetId))) {
    throw new Error(`Hard delete should bypass trash:\n${JSON.stringify(hardDeleteTrashRows, null, 2)}`);
  }

  const lsAfter = await runSkeemJson(["ls", "--counts"]);
  const widgetsAfter = expectCollection(lsAfter, "widgets");
  if (widgetsAfter.count !== 0) {
    throw new Error(`Expected widgets count to return to 0 but received ${widgetsAfter.count}.`);
  }

  const directCompany = await runSkeemJson(["create", "companies", "--name", "Direct Link Co"]);
  const directCompanyId = directCompany.data?.id;
  if (!directCompany.ok || (typeof directCompanyId !== "number" && typeof directCompanyId !== "string")) {
    throw new Error(`Failed to create direct-link company:\n${JSON.stringify(directCompany, null, 2)}`);
  }

  const directPerson = await runSkeemJson(["create", "people", "--name", "Direct Dana", "--company", `@${directCompanyId}`]);
  if (!directPerson.ok || directPerson.data?.company_id !== directCompanyId) {
    throw new Error(`@ relation create failed:\n${JSON.stringify(directPerson, null, 2)}`);
  }

  const aliasAdd = await runSkeemJson(["alias", "add", `companies:${directCompanyId}`, "ACME Inc."]);
  if (!aliasAdd.ok || !["added", "exists"].includes(aliasAdd.action ?? "")) {
    throw new Error(`Alias add failed:\n${JSON.stringify(aliasAdd, null, 2)}`);
  }

  const aliasList = await runSkeemJson(["alias", "list", `companies:${directCompanyId}`]);
  if (!aliasList.ok || aliasList.count !== 1 || aliasList.data?.[0]?.alias !== "ACME Inc.") {
    throw new Error(`Alias list failed:\n${JSON.stringify(aliasList, null, 2)}`);
  }

  const aliasSearch = await runSkeemJson(["alias", "search", "companies", "acme"]);
  if (!aliasSearch.ok || aliasSearch.count !== 1 || aliasSearch.data?.[0]?.record_id !== String(directCompanyId)) {
    throw new Error(`Alias search failed:\n${JSON.stringify(aliasSearch, null, 2)}`);
  }

  const aliasResolvedPerson = await runSkeemJson([
    "create",
    "people",
    "--name",
    "Alias Amy",
    "--company",
    "?name=ACME Inc.",
  ]);
  if (!aliasResolvedPerson.ok || aliasResolvedPerson.data?.company_id !== directCompanyId) {
    throw new Error(`Alias-backed ? resolution failed:\n${JSON.stringify(aliasResolvedPerson, null, 2)}`);
  }

  const aliasUpsert = await runSkeemJson(["upsert", "companies", "--match", "name=ACME Inc.", "--industry", "Alias Updated"]);
  if (!aliasUpsert.ok || aliasUpsert.action !== "updated" || aliasUpsert.data?.id !== directCompanyId || aliasUpsert.data?.industry !== "Alias Updated") {
    throw new Error(`Alias-backed upsert failed:\n${JSON.stringify(aliasUpsert, null, 2)}`);
  }

  const aliasLinkPerson = await runSkeemJson(["create", "people", "--name", "Alias Link Lucy"]);
  const aliasLinkPersonId = aliasLinkPerson.data?.id;
  if (!aliasLinkPerson.ok || (typeof aliasLinkPersonId !== "number" && typeof aliasLinkPersonId !== "string")) {
    throw new Error(`Failed to create alias link fixture person:\n${JSON.stringify(aliasLinkPerson, null, 2)}`);
  }

  const aliasLink = await runSkeemJson(["link", `people:${aliasLinkPersonId}`, "company", "?name=ACME Inc."]);
  if (!aliasLink.ok || aliasLink.action !== "linked" || aliasLink.data?.record?.company_id !== directCompanyId) {
    throw new Error(`Alias-backed link failed:\n${JSON.stringify(aliasLink, null, 2)}`);
  }

  const aliasRemove = await runSkeemJson(["alias", "remove", `companies:${directCompanyId}`, "ACME Inc."]);
  if (!aliasRemove.ok || aliasRemove.data?.removed !== 1) {
    throw new Error(`Alias remove failed:\n${JSON.stringify(aliasRemove, null, 2)}`);
  }

  const aliasListAfterRemove = await runSkeemJson(["alias", "list", `companies:${directCompanyId}`]);
  if (!aliasListAfterRemove.ok || aliasListAfterRemove.count !== 0) {
    throw new Error(`Alias should be gone after removal:\n${JSON.stringify(aliasListAfterRemove, null, 2)}`);
  }

  const m2oPerson = await runSkeemJson(["create", "people", "--name", "Link Lucy"]);
  const m2oPersonId = m2oPerson.data?.id;
  if (!m2oPerson.ok || (typeof m2oPersonId !== "number" && typeof m2oPersonId !== "string")) {
    throw new Error(`Failed to create M2O link fixture person:\n${JSON.stringify(m2oPerson, null, 2)}`);
  }

  const m2oLinkDryRun = await runSkeemJson(["link", `people:${m2oPersonId}`, `companies:${directCompanyId}`, "--dry-run"]);
  if (!m2oLinkDryRun.ok || m2oLinkDryRun.operation !== "dry_run" || m2oLinkDryRun.action !== "link") {
    throw new Error(`M2O link dry-run failed:\n${JSON.stringify(m2oLinkDryRun, null, 2)}`);
  }

  const m2oLink = await runSkeemJson(["link", `people:${m2oPersonId}`, `companies:${directCompanyId}`]);
  if (!m2oLink.ok || m2oLink.operation !== "link" || m2oLink.action !== "linked" || m2oLink.data?.record?.company_id !== directCompanyId) {
    throw new Error(`M2O link failed:\n${JSON.stringify(m2oLink, null, 2)}`);
  }

  const m2oLinkAgain = await runSkeemJson(["link", `people:${m2oPersonId}`, "company", `companies:${directCompanyId}`]);
  if (!m2oLinkAgain.ok || m2oLinkAgain.action !== "already_linked") {
    throw new Error(`Repeated M2O link should be idempotent:\n${JSON.stringify(m2oLinkAgain, null, 2)}`);
  }

  const m2oUnlink = await runSkeemJson(["unlink", `people:${m2oPersonId}`, "company", `companies:${directCompanyId}`]);
  if (!m2oUnlink.ok || m2oUnlink.operation !== "unlink" || m2oUnlink.action !== "unlinked" || m2oUnlink.data?.record?.company_id !== null) {
    throw new Error(`M2O unlink failed:\n${JSON.stringify(m2oUnlink, null, 2)}`);
  }

  const m2oUnlinkAgain = await runSkeemJson(["unlink", `people:${m2oPersonId}`, `companies:${directCompanyId}`]);
  if (!m2oUnlinkAgain.ok || m2oUnlinkAgain.action !== "already_unlinked") {
    throw new Error(`Repeated M2O unlink should be idempotent:\n${JSON.stringify(m2oUnlinkAgain, null, 2)}`);
  }

  const nestedPerson = await runSkeemJson([
    "create",
    "people",
    "--name",
    "Nested Nora",
    "--company.name",
    "Nested Co",
    "--company.industry",
    "Technology",
  ]);
  if (!nestedPerson.ok || nestedPerson.operation !== "compound_create" || !Array.isArray(nestedPerson.plan) || nestedPerson.plan.length < 2) {
    throw new Error(`Dot notation create failed:\n${JSON.stringify(nestedPerson, null, 2)}`);
  }
  const nestedCompany = await runSkeemJson(["find", "companies", "--where", "name=Nested Co"]);
  if (!nestedCompany.ok || nestedCompany.count !== 1 || nestedCompany.data?.[0]?.industry !== "Technology") {
    throw new Error(`Nested company was not created correctly:\n${JSON.stringify(nestedCompany, null, 2)}`);
  }

  const resolvedPerson = await runSkeemJson([
    "create",
    "people",
    "--name",
    "Resolved Rita",
    "--company",
    "?name=Nested Co",
  ]);
  if (!resolvedPerson.ok || resolvedPerson.data?.company_id !== nestedCompany.data[0]?.id) {
    throw new Error(`? relation resolve failed:\n${JSON.stringify(resolvedPerson, null, 2)}`);
  }

  const resolveOrCreatePerson = await runSkeemJson([
    "create",
    "people",
    "--name",
    "Fallback Finn",
    "--company",
    "??name=Fallback Co",
    "--company.industry",
    "Services",
  ]);
  if (!resolveOrCreatePerson.ok) {
    throw new Error(`?? relation create failed:\n${JSON.stringify(resolveOrCreatePerson, null, 2)}`);
  }

  const fallbackCompanies = await runSkeemJson(["find", "companies", "--where", "name=Fallback Co"]);
  if (!fallbackCompanies.ok || fallbackCompanies.count !== 1 || fallbackCompanies.data?.[0]?.industry !== "Services") {
    throw new Error(`?? did not create fallback company correctly:\n${JSON.stringify(fallbackCompanies, null, 2)}`);
  }

  const resolveOrCreateAgain = await runSkeemJson([
    "create",
    "people",
    "--name",
    "Fallback Fern",
    "--company",
    "??name=Fallback Co",
    "--company.industry",
    "Ignored Update",
  ]);
  if (!resolveOrCreateAgain.ok) {
    throw new Error(`Second ?? relation create failed:\n${JSON.stringify(resolveOrCreateAgain, null, 2)}`);
  }

  const fallbackCompaniesAfterRepeat = await runSkeemJson(["find", "companies", "--where", "name=Fallback Co"]);
  if (!fallbackCompaniesAfterRepeat.ok || fallbackCompaniesAfterRepeat.count !== 1 || fallbackCompaniesAfterRepeat.data?.[0]?.industry !== "Services") {
    throw new Error(`?? should resolve existing company without mutating it:\n${JSON.stringify(fallbackCompaniesAfterRepeat, null, 2)}`);
  }

  const rollbackFailure = await runSkeemJson([
    "create",
    "people",
    "--company.name",
    "Rollback Co",
  ], { expectFailure: true });
  if (rollbackFailure.ok) {
    throw new Error(`Expected rollback fixture create to fail:\n${JSON.stringify(rollbackFailure, null, 2)}`);
  }

  const rollbackCompanies = await runSkeemJson(["find", "companies", "--where", "name=Rollback Co"]);
  if (!rollbackCompanies.ok || rollbackCompanies.count !== 0) {
    throw new Error(`Rollback did not clean up created child record:\n${JSON.stringify(rollbackCompanies, null, 2)}`);
  }

  const execPlan = {
    operations: [
      {
        ref: "updated_person",
        op: "update",
        collection: "people",
        id: "$person_a.id",
        data: {
          name: "Exec Alice Updated",
        },
      },
      {
        ref: "person_b_check",
        op: "get",
        collection: "people",
        id: "$person_b.id",
      },
      {
        ref: "person_a",
        op: "create",
        collection: "people",
        data: {
          name: "Exec Alice",
          company_id: "$company.id",
        },
      },
      {
        ref: "company",
        op: "create",
        collection: "companies",
        data: {
          name: "Exec Co",
          industry: "Automation",
        },
      },
      {
        ref: "person_b",
        op: "create",
        collection: "people",
        data: {
          name: "Exec Bob",
          company_id: "$company.id",
        },
      },
    ],
  };

  const execDryRun = await runSkeemJson(["exec", "--dry-run"], {
    stdin: JSON.stringify(execPlan),
  });
  if (!execDryRun.ok || execDryRun.operation !== "dry_run" || !Array.isArray(execDryRun.plan)) {
    throw new Error(`Exec dry-run failed:\n${JSON.stringify(execDryRun, null, 2)}`);
  }
  const execDryRunOrder = execDryRun.plan.map((entry) => entry.ref);
  if (execDryRunOrder.join(",") !== "company,person_a,updated_person,person_b,person_b_check") {
    throw new Error(`Exec dry-run order was unexpected:\n${JSON.stringify(execDryRun, null, 2)}`);
  }

  const execResult = await runSkeemJson(["exec"], {
    stdin: JSON.stringify(execPlan),
  });
  if (!execResult.ok || execResult.operation !== "exec" || !Array.isArray(execResult.plan) || execResult.plan.length !== 5) {
    throw new Error(`Exec failed:\n${JSON.stringify(execResult, null, 2)}`);
  }

  const execCompany = execResult.plan.find((entry) => entry.ref === "company");
  const execPersonAUpdated = execResult.plan.find((entry) => entry.ref === "updated_person");
  const execPersonBCheck = execResult.plan.find((entry) => entry.ref === "person_b_check");
  const execCompanyId = execCompany?.data?.id;

  if (execCompany?.data?.name !== "Exec Co") {
    throw new Error(`Exec did not create the company correctly:\n${JSON.stringify(execResult, null, 2)}`);
  }
  if (execPersonAUpdated?.data?.name !== "Exec Alice Updated") {
    throw new Error(`Exec did not update person A correctly:\n${JSON.stringify(execResult, null, 2)}`);
  }
  if (execPersonBCheck?.data?.name !== "Exec Bob" || execPersonBCheck?.data?.company_id !== execCompanyId) {
    throw new Error(`Exec get step did not resolve person B correctly:\n${JSON.stringify(execResult, null, 2)}`);
  }

  const execPeopleByName = await runSkeemJson(["find", "people", "--where", "name=Exec Alice Updated"]);
  if (!execPeopleByName.ok || execPeopleByName.count !== 1) {
    throw new Error(`Updated exec person was not discoverable:\n${JSON.stringify(execPeopleByName, null, 2)}`);
  }

  const execVerbPlan = {
    operations: [
      {
        ref: "company_check",
        op: "get",
        collection: "companies",
        id: "$company_update.id",
      },
      {
        ref: "person_unlink",
        op: "unlink",
        collection: "people",
        id: "$person_link.source.id",
        relation: "company",
        target: {
          id: "$person_link.target.id",
          collection: "companies",
        },
      },
      {
        ref: "person_check",
        op: "get",
        collection: "people",
        id: "$person_unlink.source.id",
      },
      {
        ref: "person_link",
        op: "link",
        collection: "people",
        id: "$person_seed.id",
        relation: "company",
        target: {
          id: "$company_seed.id",
          collection: "companies",
        },
      },
      {
        ref: "company_update",
        op: "upsert",
        collection: "companies",
        match: {
          name: "$company_seed.name",
        },
        data: {
          industry: "Strategy",
        },
      },
      {
        ref: "person_seed",
        op: "upsert",
        collection: "people",
        match: {
          name: "Exec Verb Person",
        },
      },
      {
        ref: "company_seed",
        op: "upsert",
        collection: "companies",
        match: {
          name: "Exec Verb Co",
        },
        data: {
          industry: "Services",
        },
      },
    ],
  };

  const execVerbDryRun = await runSkeemJson(["exec", "--dry-run"], {
    stdin: JSON.stringify(execVerbPlan),
  });
  if (!execVerbDryRun.ok || execVerbDryRun.operation !== "dry_run" || !Array.isArray(execVerbDryRun.plan)) {
    throw new Error(`Exec higher-level dry-run failed:\n${JSON.stringify(execVerbDryRun, null, 2)}`);
  }
  const execVerbDryRunOrder = execVerbDryRun.plan.map((entry) => entry.ref);
  if (execVerbDryRunOrder.join(",") !== "company_seed,company_update,company_check,person_seed,person_link,person_unlink,person_check") {
    throw new Error(`Exec higher-level dry-run order was unexpected:\n${JSON.stringify(execVerbDryRun, null, 2)}`);
  }

  const execVerbResult = await runSkeemJson(["exec"], {
    stdin: JSON.stringify(execVerbPlan),
  });
  if (!execVerbResult.ok || execVerbResult.operation !== "exec" || !Array.isArray(execVerbResult.plan) || execVerbResult.plan.length !== 7) {
    throw new Error(`Exec higher-level verbs failed:\n${JSON.stringify(execVerbResult, null, 2)}`);
  }

  const execVerbCompanySeed = execVerbResult.plan.find((entry) => entry.ref === "company_seed");
  const execVerbCompanyUpdate = execVerbResult.plan.find((entry) => entry.ref === "company_update");
  const execVerbPersonLink = execVerbResult.plan.find((entry) => entry.ref === "person_link");
  const execVerbPersonUnlink = execVerbResult.plan.find((entry) => entry.ref === "person_unlink");
  const execVerbPersonCheck = execVerbResult.plan.find((entry) => entry.ref === "person_check");
  const execVerbCompanyCheck = execVerbResult.plan.find((entry) => entry.ref === "company_check");

  if (execVerbCompanySeed?.data?.industry !== "Services") {
    throw new Error(`Exec upsert create did not produce the expected company:\n${JSON.stringify(execVerbResult, null, 2)}`);
  }
  if (execVerbCompanyUpdate?.data?.industry !== "Strategy") {
    throw new Error(`Exec upsert update did not persist the expected company changes:\n${JSON.stringify(execVerbResult, null, 2)}`);
  }
  if (execVerbPersonLink?.data?.action !== "linked") {
    throw new Error(`Exec link did not report a linked action:\n${JSON.stringify(execVerbResult, null, 2)}`);
  }
  if (execVerbPersonUnlink?.data?.action !== "unlinked") {
    throw new Error(`Exec unlink did not report an unlinked action:\n${JSON.stringify(execVerbResult, null, 2)}`);
  }
  if (execVerbPersonCheck?.data?.company_id !== null) {
    throw new Error(`Exec unlink should leave the person detached:\n${JSON.stringify(execVerbResult, null, 2)}`);
  }
  if (execVerbCompanyCheck?.data?.industry !== "Strategy") {
    throw new Error(`Exec company check did not see the updated company:\n${JSON.stringify(execVerbResult, null, 2)}`);
  }

  await prepareConfigWorkspace();
  await clearCacheAt(configWorkspaceDir);

  const configCacheBefore = await runSkeemJson(["cache", "show"], {
    cwd: configNestedDir,
    skipConnectionFlags: true,
    env: {
      SKEEM_SMOKE_TOKEN: adminToken,
    },
  });
  if (!configCacheBefore.ok || configCacheBefore.data?.exists !== false) {
    throw new Error(`Expected workspace cache to start empty:\n${JSON.stringify(configCacheBefore, null, 2)}`);
  }
  const expectedWorkspaceCacheDir = path.join(configWorkspaceDir, ".skeem", "cache");
  if (configCacheBefore.data?.cacheDir !== expectedWorkspaceCacheDir) {
    throw new Error(`Cache should be rooted at the config workspace:\n${JSON.stringify(configCacheBefore, null, 2)}`);
  }

  const configDefaultProfile = await runSkeemJson(["find", "firm", "--where", "name=Exec Co"], {
    cwd: configNestedDir,
    skipConnectionFlags: true,
    env: {
      SKEEM_SMOKE_TOKEN: adminToken,
    },
  });
  if (!configDefaultProfile.ok || configDefaultProfile.count !== 1) {
    throw new Error(`Default profile or alias resolution failed:\n${JSON.stringify(configDefaultProfile, null, 2)}`);
  }

  const configCacheAfterMiss = await runSkeemJson(["cache", "show"], {
    cwd: configNestedDir,
    skipConnectionFlags: true,
    env: {
      SKEEM_SMOKE_TOKEN: adminToken,
    },
  });
  if (!configCacheAfterMiss.ok || configCacheAfterMiss.data?.exists !== true) {
    throw new Error(`Cache miss should populate the workspace cache:\n${JSON.stringify(configCacheAfterMiss, null, 2)}`);
  }
  const firstCacheSavedAt = configCacheAfterMiss.data?.meta?.savedAt;

  const configCacheHit = await runSkeemJson(["find", "firm", "--where", "name=Exec Co"], {
    cwd: configNestedDir,
    skipConnectionFlags: true,
    env: {
      SKEEM_SMOKE_TOKEN: adminToken,
    },
  });
  if (!configCacheHit.ok || configCacheHit.count !== 1) {
    throw new Error(`Config-backed cache-hit query failed:\n${JSON.stringify(configCacheHit, null, 2)}`);
  }

  const configCacheAfterHit = await runSkeemJson(["cache", "show"], {
    cwd: configNestedDir,
    skipConnectionFlags: true,
    env: {
      SKEEM_SMOKE_TOKEN: adminToken,
    },
  });
  if (configCacheAfterHit.data?.meta?.savedAt !== firstCacheSavedAt) {
    throw new Error(`Cache hit should not rewrite cache metadata:\n${JSON.stringify(configCacheAfterHit, null, 2)}`);
  }

  const configEnvProfile = await runSkeemJson(["find", "org", "--where", "name=Exec Co"], {
    cwd: configNestedDir,
    skipConnectionFlags: true,
    env: {
      SKEEM_PROFILE: "alt",
      SKEEM_SMOKE_TOKEN: adminToken,
      SKEEM_SMOKE_URL: baseUrl,
    },
  });
  if (!configEnvProfile.ok || configEnvProfile.count !== 1) {
    throw new Error(`Env-selected profile or interpolated URL failed:\n${JSON.stringify(configEnvProfile, null, 2)}`);
  }

  await sleep(25);

  const configRefresh = await runSkeemJson(["find", "firm", "--where", "name=Exec Co", "--refresh"], {
    cwd: configNestedDir,
    skipConnectionFlags: true,
    env: {
      SKEEM_SMOKE_TOKEN: adminToken,
    },
  });
  if (!configRefresh.ok || configRefresh.count !== 1) {
    throw new Error(`Cache refresh query failed:\n${JSON.stringify(configRefresh, null, 2)}`);
  }

  const configCacheAfterRefresh = await runSkeemJson(["cache", "show"], {
    cwd: configNestedDir,
    skipConnectionFlags: true,
    env: {
      SKEEM_SMOKE_TOKEN: adminToken,
    },
  });
  if (configCacheAfterRefresh.data?.meta?.savedAt === firstCacheSavedAt) {
    throw new Error(`--refresh should rewrite cache metadata:\n${JSON.stringify(configCacheAfterRefresh, null, 2)}`);
  }

  await clearCacheAt(configWorkspaceDir);

  const configNoCache = await runSkeemJson(["find", "widgets", "--where", "name=Beta Widget", "--no-cache"], {
    cwd: configNestedDir,
    skipConnectionFlags: true,
    env: {
      SKEEM_SMOKE_TOKEN: adminToken,
    },
  });
  if (!configNoCache.ok || configNoCache.count !== 0) {
    throw new Error(`--no-cache query failed:\n${JSON.stringify(configNoCache, null, 2)}`);
  }

  const configCacheAfterNoCache = await runSkeemJson(["cache", "show"], {
    cwd: configNestedDir,
    skipConnectionFlags: true,
    env: {
      SKEEM_SMOKE_TOKEN: adminToken,
    },
  });
  if (!configCacheAfterNoCache.ok || configCacheAfterNoCache.data?.exists !== false) {
    throw new Error(`--no-cache should not write cache files:\n${JSON.stringify(configCacheAfterNoCache, null, 2)}`);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        checks: {
          ls: true,
          cache: true,
          describe: true,
          discover: true,
          diffDefine: true,
          diffDiscover: true,
          defineDryRun: true,
          defineApply: true,
          defineDestructiveSkip: true,
          defineDestructiveApply: true,
          initStatusBefore: true,
          initApply: true,
          initStatusAfter: true,
          initAgain: true,
          claimAcquire: true,
          claimStatus: true,
          claimOwnership: true,
          claimRelease: true,
          claimExpiry: true,
          annotateDryRun: true,
          annotateWrite: true,
          annotateRead: true,
          idempotencyCreate: true,
          idempotencyMismatch: true,
          idempotencyUpdate: true,
          idempotencyUpsert: true,
          idempotencyDelete: true,
          idempotencyLink: true,
          idempotencyUnlink: true,
          idempotencyAnnotate: true,
          provenanceCreate: true,
          provenanceUpsert: true,
          provenanceLink: true,
          provenanceUnlink: true,
          provenanceDelete: true,
          versionUpdate: true,
          versionUpsert: true,
          upsertCreate: true,
          upsertUpdate: true,
          linkM2m: true,
          unlinkM2m: true,
          linkM2o: true,
          unlinkM2o: true,
          aliasAdd: true,
          aliasList: true,
          aliasSearch: true,
          aliasResolve: true,
          aliasUpsert: true,
          aliasLink: true,
          aliasRemove: true,
          relationDryRun: true,
          create: true,
          get: true,
          find: true,
          update: true,
          delete: true,
          restore: true,
          hardDelete: true,
          relationAt: true,
          relationDot: true,
          relationResolve: true,
          relationResolveOrCreate: true,
          relationRollback: true,
          execDryRun: true,
          exec: true,
          execVerbDryRun: true,
          execVerbs: true,
          configDefaultProfile: true,
          configEnvProfile: true,
          cacheMiss: true,
          cacheHit: true,
          cacheRefresh: true,
          cacheNoCache: true,
        },
        widgetId,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await stopExistingDirectus(serverProcess);
}

async function ensureFixtureProject() {
  await mkdir(projectDir, { recursive: true });
  await mkdir(databaseDir, { recursive: true });
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(extensionsDir, { recursive: true });

  await writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify(
      {
        name: "skeem-directus-smoke",
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
    path.join(projectDir, ".env"),
    [
      `HOST=${host}`,
      `PORT=${port}`,
      "KEY=skeem-smoke-key",
      "SECRET=skeem-smoke-secret",
      "DB_CLIENT=sqlite3",
      "DB_FILENAME=./database/data.db",
      `PUBLIC_URL=${baseUrl}`,
      `ADMIN_EMAIL=${adminEmail}`,
      `ADMIN_PASSWORD=${adminPassword}`,
      `ADMIN_TOKEN=${adminToken}`,
      "WEBSOCKETS_ENABLED=true",
    ].join("\n"),
  );

  const hasNodeModules = await exists(path.join(projectDir, "node_modules"));
  if (!hasNodeModules) {
    const install = runCommand("npm", ["install", "--no-fund", "--no-audit"], { cwd: projectDir });
    if (install.status !== 0) {
      throw new Error(`Failed to install Directus smoke fixture:\n${install.stderr || install.stdout}`);
    }
  }
}

async function resetDatabase() {
  await rm(databaseDir, { recursive: true, force: true });
  await mkdir(databaseDir, { recursive: true });
}

async function bootstrapDirectus() {
  const bootstrap = runCommand("npx", ["directus", "bootstrap"], { cwd: projectDir });
  if (bootstrap.status !== 0) {
    throw new Error(`Failed to bootstrap Directus:\n${bootstrap.stderr || bootstrap.stdout}`);
  }
}

function startDirectus() {
  const child = spawn("npx", ["directus", "start"], {
    cwd: projectDir,
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
      // Keep waiting while the server starts.
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for Directus.\nSTDOUT:\n${capturedStdout}\nSTDERR:\n${capturedStderr}`);
}

async function ensureCollection(definition) {
  const collectionName = definition.name;
  const list = await requestJson("/collections");
  const existsAlready = Array.isArray(list.data) && list.data.some((entry) => entry.collection === collectionName);
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
      collection: collectionName,
      meta: {
        collection: collectionName,
        icon: "inventory_2",
      },
      schema: {
        name: collectionName,
      },
      fields: definition.fields.map((field) => ({
        ...field,
        schema: {
          ...field.schema,
          table: collectionName,
        },
      })),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create collection "${collectionName}":\n${body}`);
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
    const body = await response.text();
    throw new Error(`Failed to create relation ${definition.collectionMany}.${definition.fieldMany} -> ${definition.collectionOne}:\n${body}`);
  }
}

async function clearSkeemCache() {
  await rm(path.join(repoRoot, ".skeem"), { recursive: true, force: true });
}

async function clearCacheAt(rootDir) {
  await rm(path.join(rootDir, ".skeem"), { recursive: true, force: true });
}

async function prepareConfigWorkspace() {
  await mkdir(configNestedDir, { recursive: true });
  await writeFile(
    configPath,
    [
      "default: local",
      "cache:",
      "  ttl_ms: 600000",
      "profiles:",
      "  local:",
      "    adapter: directus",
      "    connection:",
      `      url: \"${baseUrl}\"`,
      "      token: \"${SKEEM_SMOKE_TOKEN}\"",
      "    schema:",
      "      aliases:",
      "        firm: companies",
      "  alt:",
      "    adapter: directus",
      "    connection:",
      "      url: \"${SKEEM_SMOKE_URL}\"",
      "      token: \"${SKEEM_SMOKE_TOKEN}\"",
      "    schema:",
      "      aliases:",
      "        org: companies",
    ].join("\n"),
  );
}

async function stopExistingDirectus(child) {
  if (child?.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Fall back to pattern kill below.
    }
  }

  runCommand("pkill", ["-f", `${projectDir}/node_modules/.bin/directus start`], { cwd: repoRoot });
  runCommand("pkill", ["-f", "npm exec directus start"], { cwd: repoRoot });
  await sleep(1_000);
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

function runCommand(command, args, options) {
  return spawnSync(command, args, {
    ...options,
    encoding: "utf8",
  });
}

async function runSkeemJson(args, options = {}) {
  const commandArgs = [
    path.join(repoRoot, "packages", "skeem", "dist", "bin", "skeem.js"),
    ...args,
    "--json",
    ...(options.skipConnectionFlags ? [] : ["--url", baseUrl, "--token", adminToken]),
  ];

  const cli = runCommand("node", commandArgs, {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
    ...(options.stdin ? { input: `${options.stdin}\n` } : {}),
  });

  return parseSkeemResult(cli, args, options);
}

function parseSkeemResult(cli, args, options) {
  const expectedFailure = options.expectFailure === true;
  if (!expectedFailure && cli.status !== 0) {
    throw new Error(`skeem ${args[0]} failed:\n${cli.stderr || cli.stdout}`);
  }
  if (expectedFailure && cli.status === 0) {
    throw new Error(`skeem ${args[0]} unexpectedly succeeded:\n${cli.stdout}`);
  }

  try {
    return JSON.parse(cli.stdout);
  } catch (error) {
    throw new Error(`Failed to parse CLI JSON output for ${args.join(" ")}:\n${cli.stdout}\n${error}`);
  }
}

function expectCollection(envelope, collectionName) {
  if (!envelope.ok || !Array.isArray(envelope.data)) {
    throw new Error(`Expected collection list envelope:\n${JSON.stringify(envelope, null, 2)}`);
  }

  const collection = envelope.data.find((entry) => entry.collection === collectionName);
  if (!collection) {
    throw new Error(`Expected collection "${collectionName}" in envelope:\n${JSON.stringify(envelope, null, 2)}`);
  }

  return collection;
}

function expectDiffChange(envelope, expected) {
  if (!envelope.ok || !Array.isArray(envelope.data?.changes)) {
    throw new Error(`Expected diff envelope with changes:\n${JSON.stringify(envelope, null, 2)}`);
  }

  const match = envelope.data.changes.find((change) => (
    change.scope === expected.scope &&
    change.name === expected.name &&
    (expected.collection === undefined || change.collection === expected.collection) &&
    change.status === expected.status &&
    change.resolution === expected.resolution
  ));

  if (!match) {
    throw new Error(`Expected diff change ${JSON.stringify(expected)}:\n${JSON.stringify(envelope, null, 2)}`);
  }

  return match;
}

function expectPlanAction(envelope, expected) {
  if (!envelope.ok || !Array.isArray(envelope.plan)) {
    throw new Error(`Expected plan envelope:\n${JSON.stringify(envelope, null, 2)}`);
  }

  const match = envelope.plan.find((entry) => (
    entry.action === expected.action &&
    (expected.collection === undefined || entry.collection === expected.collection) &&
    (expected.field === undefined || entry.field === expected.field)
  ));

  if (!match) {
    throw new Error(`Expected plan action ${JSON.stringify(expected)}:\n${JSON.stringify(envelope, null, 2)}`);
  }

  return match;
}

function expectProvenanceEntry(envelope, expected) {
  if (!envelope.ok || !Array.isArray(envelope.data)) {
    throw new Error(`Expected provenance envelope:\n${JSON.stringify(envelope, null, 2)}`);
  }

  const match = envelope.data.find((entry) => (
    entry.collection === expected.collection &&
    entry.operation === expected.operation &&
    String(entry.record_id) === String(expected.recordId)
  ));

  if (!match) {
    throw new Error(`Expected provenance entry ${JSON.stringify(expected)}:\n${JSON.stringify(envelope, null, 2)}`);
  }

  return match;
}

function expectVersionEntries(envelope, expected) {
  if (!envelope.ok || !Array.isArray(envelope.data)) {
    throw new Error(`Expected version envelope:\n${JSON.stringify(envelope, null, 2)}`);
  }

  const matches = envelope.data.filter((entry) => (
    entry.collection === expected.collection &&
    String(entry.record_id) === String(expected.recordId)
  ));

  if (matches.length !== expected.count) {
    throw new Error(`Expected ${expected.count} version rows for ${JSON.stringify(expected)}:\n${JSON.stringify(envelope, null, 2)}`);
  }

  return matches;
}

function expectTrashEntry(envelope, expected) {
  if (!envelope.ok || !Array.isArray(envelope.data)) {
    throw new Error(`Expected trash envelope:\n${JSON.stringify(envelope, null, 2)}`);
  }

  const match = envelope.data.find((entry) => (
    entry.collection === expected.collection &&
    String(entry.record_id) === String(expected.recordId)
  ));

  if (!match) {
    throw new Error(`Expected trash entry ${JSON.stringify(expected)}:\n${JSON.stringify(envelope, null, 2)}`);
  }

  return match;
}

function expectClaimEntry(envelope, expected) {
  if (!envelope.ok || !Array.isArray(envelope.data)) {
    throw new Error(`Expected claims envelope:\n${JSON.stringify(envelope, null, 2)}`);
  }

  const matches = envelope.data.filter((entry) => (
    entry.collection === expected.collection &&
    String(entry.record_id) === String(expected.recordId)
  ));

  if (matches.length !== 1) {
    throw new Error(`Expected exactly one claim row for ${JSON.stringify(expected)}:\n${JSON.stringify(envelope, null, 2)}`);
  }

  return matches[0];
}

function expectAnnotationEntry(envelope, expected) {
  if (!envelope.ok || !Array.isArray(envelope.data)) {
    throw new Error(`Expected annotations envelope:\n${JSON.stringify(envelope, null, 2)}`);
  }

  const matches = envelope.data.filter((entry) => (
    entry.collection === expected.collection &&
    String(entry.record_id) === String(expected.recordId) &&
    entry.key === expected.key
  ));

  if (matches.length !== 1) {
    throw new Error(`Expected exactly one annotation row for ${JSON.stringify(expected)}:\n${JSON.stringify(envelope, null, 2)}`);
  }

  return matches[0];
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

async function exists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
