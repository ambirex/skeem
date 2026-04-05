import type { SuccessEnvelope } from "../types/index.js";

const IDEMPOTENCY_METADATA_KEY = "__skeem_idempotency";

export interface IdempotencyRequest {
  operation: string;
  collection: string;
  input: unknown;
}

export interface IdempotencyMetadata {
  version: 1;
  request: IdempotencyRequest;
  response: Omit<SuccessEnvelope, "ok">;
}

export function attachIdempotencyMetadata(
  inputRefs: unknown,
  request: IdempotencyRequest,
  response: Omit<SuccessEnvelope, "ok">,
): unknown {
  const metadata: IdempotencyMetadata = {
    version: 1,
    request,
    response,
  };

  if (isPlainObject(inputRefs)) {
    return {
      ...inputRefs,
      [IDEMPOTENCY_METADATA_KEY]: metadata,
    };
  }

  return {
    value: inputRefs,
    [IDEMPOTENCY_METADATA_KEY]: metadata,
  };
}

export function extractIdempotencyMetadata(inputRefs: unknown): IdempotencyMetadata | null {
  if (!isPlainObject(inputRefs)) {
    return null;
  }

  const metadata = inputRefs[IDEMPOTENCY_METADATA_KEY];
  if (!isPlainObject(metadata)) {
    return null;
  }

  const request = metadata.request;
  const response = metadata.response;
  if (!isPlainObject(request) || !isPlainObject(response)) {
    return null;
  }
  if (typeof request.operation !== "string" || typeof request.collection !== "string") {
    return null;
  }
  if (typeof response.operation !== "string") {
    return null;
  }

  return {
    version: 1,
    request: request as unknown as IdempotencyRequest,
    response: response as unknown as Omit<SuccessEnvelope, "ok">,
  };
}

export function idempotencyRequestsMatch(left: IdempotencyRequest, right: IdempotencyRequest): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
