import type { Filter, PrimaryKey } from "../types/index.js";

export class SkemError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends SkemError {
  constructor(
    public readonly collection: string,
    public readonly id?: PrimaryKey,
    public readonly filter?: Filter,
  ) {
    super(`No record found in "${collection}".`, "NOT_FOUND", { id, filter });
  }
}

export class AmbiguousError extends SkemError {
  constructor(
    public readonly collection: string,
    public readonly filter: Filter,
    public readonly count: number,
  ) {
    super(`Expected one record in "${collection}" but found ${count}.`, "AMBIGUOUS", { filter, count });
  }
}

export class DuplicateError extends SkemError {
  constructor(
    public readonly collection: string,
    public readonly constraint: string[],
  ) {
    super(`Duplicate record in "${collection}".`, "DUPLICATE", { constraint });
  }
}

export class ValidationError extends SkemError {
  constructor(
    public readonly collection: string,
    public readonly field: string,
    message?: string,
  ) {
    super(message ?? `Validation failed for "${field}" on "${collection}".`, "VALIDATION", { field });
  }
}

export class AuthError extends SkemError {
  constructor(message = "Authentication failed.") {
    super(message, "AUTH");
  }
}

export class SchemaUnsupportedError extends SkemError {
  constructor(message: string) {
    super(message, "SCHEMA_UNSUPPORTED");
  }
}

export class RelationNotFoundError extends SkemError {
  constructor(
    public readonly collection: string,
    public readonly path: string,
  ) {
    super(`No relation found from "${collection}" for path "${path}".`, "RELATION_NOT_FOUND", { path });
  }
}

export class CacheStaleError extends SkemError {
  constructor(message = "Schema cache is stale.") {
    super(message, "CACHE_STALE");
  }
}

export class UsageError extends SkemError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "USAGE", details);
  }
}
