import type { FieldType, Schema } from "../types/index.js";

export interface SystemFieldDefinition {
  name: string;
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
}

export interface SystemCollectionDefinition {
  name: string;
  purpose: string;
  fields: SystemFieldDefinition[];
  notes?: string[];
}

export interface SystemCollectionStatus {
  collection: string;
  exists: boolean;
  supported: boolean;
  purpose: string;
  notes?: string[];
}

const SYSTEM_COLLECTIONS: SystemCollectionDefinition[] = [
  {
    name: "skeem_aliases",
    purpose: "Shared alias lookup for identity-backed resolution.",
    fields: [
      { name: "collection", type: "string", required: true },
      { name: "record_id", type: "string", required: true },
      { name: "alias", type: "string", required: true },
      { name: "alias_normalized", type: "string", required: true },
      { name: "created_by", type: "string" },
      { name: "created_at", type: "datetime" },
    ],
    notes: [
      "Composite uniqueness for (collection, alias_normalized) is currently enforced in the runtime until adapter-level composite constraints land.",
    ],
  },
  {
    name: "skeem_provenance",
    purpose: "Write-level provenance for skeem mutations.",
    fields: [
      { name: "collection", type: "string", required: true },
      { name: "record_id", type: "string", required: true },
      { name: "operation", type: "string", required: true },
      { name: "actor", type: "string", required: true },
      { name: "actor_type", type: "string" },
      { name: "context", type: "json" },
      { name: "input_refs", type: "json" },
      { name: "idempotency_key", type: "string" },
      { name: "created_at", type: "datetime" },
    ],
    notes: [
      "Runtime writes currently populate actor_type and created_at instead of relying on database defaults.",
      "Idempotency key storage is available now; uniqueness enforcement is deferred until replay semantics land.",
    ],
  },
  {
    name: "skeem_versions",
    purpose: "Version history snapshots for update-style mutations.",
    fields: [
      { name: "collection", type: "string", required: true },
      { name: "record_id", type: "string", required: true },
      { name: "version", type: "integer", required: true },
      { name: "snapshot", type: "json", required: true },
      { name: "changed_fields", type: "json" },
      { name: "provenance_id", type: "integer" },
      { name: "created_at", type: "datetime" },
    ],
    notes: [
      "Version numbers are assigned per (collection, record_id) in the runtime.",
      "provenance_id stores the linked skeem_provenance row id; the Directus relation is deferred until system-table relations are provisioned generically.",
    ],
  },
  {
    name: "skeem_trash",
    purpose: "Soft-delete snapshots that can be restored later.",
    fields: [
      { name: "collection", type: "string", required: true },
      { name: "record_id", type: "string", required: true },
      { name: "snapshot", type: "json", required: true },
      { name: "deleted_by", type: "string" },
      { name: "provenance_id", type: "integer" },
      { name: "deleted_at", type: "datetime" },
      { name: "expires_at", type: "datetime" },
    ],
    notes: [
      "Soft delete currently stores the full pre-delete snapshot and linked provenance row id.",
      "Expiry and purge behavior are deferred until broader trash lifecycle support lands.",
    ],
  },
  {
    name: "skeem_claims",
    purpose: "Lease-based coordination for shared record work.",
    fields: [
      { name: "collection", type: "string", required: true },
      { name: "record_id", type: "string", required: true },
      { name: "claimed_by", type: "string", required: true },
      { name: "purpose", type: "string" },
      { name: "lease_until", type: "datetime", required: true },
      { name: "created_at", type: "datetime" },
    ],
    notes: [
      "Composite uniqueness for (collection, record_id) is currently enforced in the runtime until adapter-level composite constraints land.",
      "Expired leases are ignored by read paths and cleaned up best-effort during claim operations.",
    ],
  },
  {
    name: "skeem_annotations",
    purpose: "Record-scoped metadata that stays out of business schemas.",
    fields: [
      { name: "collection", type: "string", required: true },
      { name: "record_id", type: "string", required: true },
      { name: "key", type: "string", required: true },
      { name: "value", type: "json", required: true },
      { name: "actor", type: "string" },
      { name: "created_at", type: "datetime" },
      { name: "expires_at", type: "datetime" },
    ],
    notes: [
      "Annotations are append-only metadata rows for now; higher-level query and merge semantics are deferred.",
      "Expiry metadata is stored now; lifecycle cleanup and automatic filtering are deferred.",
    ],
  },
];

export function listSupportedSystemCollections(): SystemCollectionDefinition[] {
  return SYSTEM_COLLECTIONS.map((definition) => ({
    ...definition,
    fields: definition.fields.map((field) => ({ ...field })),
    ...(definition.notes ? { notes: [...definition.notes] } : {}),
  }));
}

export function getSystemCollectionDefinition(name: string): SystemCollectionDefinition | undefined {
  return SYSTEM_COLLECTIONS.find((definition) => definition.name === name);
}

export function buildSystemCollectionStatus(schema: Schema): SystemCollectionStatus[] {
  return listSupportedSystemCollections().map((definition) => ({
    collection: definition.name,
    exists: schema.collections.has(definition.name),
    supported: true,
    purpose: definition.purpose,
    ...(definition.notes ? { notes: definition.notes } : {}),
  }));
}
