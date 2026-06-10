import type { AdapterConfig } from "./types.js";
import { NocoDbRequestError } from "./types.js";

/**
 * Thin HTTP wrapper around the NocoDB REST API. Authentication is the `xc-token`
 * header (an API token created in NocoDB). The client is transport-only; all
 * name↔id resolution lives in the catalog.
 */
export class NocoDbClient {
  private baseUrl?: string;
  private token?: string;

  connect(config: AdapterConfig): void {
    this.baseUrl = config.url.replace(/\/+$/, "");
    this.token = config.token ? String(config.token) : undefined;
  }

  get<T>(pathname: string, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>(pathname, { method: "GET", query });
  }

  post<T>(pathname: string, body: unknown): Promise<T> {
    return this.request<T>(pathname, { method: "POST", body });
  }

  patch<T>(pathname: string, body: unknown): Promise<T> {
    return this.request<T>(pathname, { method: "PATCH", body });
  }

  async delete(pathname: string, body?: unknown): Promise<void> {
    await this.request(pathname, { method: "DELETE", body });
  }

  private async request<T>(
    pathname: string,
    init: { method: string; query?: Record<string, unknown>; body?: unknown },
  ): Promise<T> {
    if (!this.baseUrl) {
      throw new Error("NocoDB client has not been connected.");
    }

    const url = new URL(pathname, `${this.baseUrl}/`);
    if (init.query) {
      for (const [key, value] of Object.entries(init.query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await fetch(url, {
      method: init.method,
      headers: {
        Accept: "application/json",
        ...(this.token ? { "xc-token": this.token } : {}),
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

    if (response.status === 204) {
      return undefined as T;
    }

    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new NocoDbRequestError(
        extractMessage(payload) ?? response.statusText,
        response.status,
        typeof payload?.error === "string" ? payload.error : undefined,
        payload && typeof payload === "object" ? payload : undefined,
      );
    }

    return payload as T;
  }
}

function extractMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  // NocoDB error bodies vary: { msg }, { message }, or { error, message }.
  for (const key of ["msg", "message"]) {
    const value = p[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}
