import type { AdapterConfig } from "./types.js";
import { PocketBaseRequestError } from "./types.js";

export class PocketBaseClient {
  private baseUrl?: string;
  private token?: string;

  async connect(config: AdapterConfig): Promise<void> {
    this.baseUrl = config.url.replace(/\/+$/, "");

    if (config.token) {
      this.token = String(config.token);
      return;
    }

    const email = config["email"];
    const password = config["password"];
    if (typeof email === "string" && typeof password === "string") {
      const url = `${this.baseUrl}/api/collections/_superusers/auth-with-password`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ identity: email, password }),
      });
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        throw new PocketBaseRequestError(
          payload?.message ?? response.statusText,
          response.status,
        );
      }
      this.token = payload.token;
    }
  }

  async get<T>(pathname: string, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>(pathname, { method: "GET", query });
  }

  async post<T>(pathname: string, body: unknown): Promise<T> {
    return this.request<T>(pathname, { method: "POST", body });
  }

  async patch<T>(pathname: string, body: unknown): Promise<T> {
    return this.request<T>(pathname, { method: "PATCH", body });
  }

  async delete(pathname: string): Promise<void> {
    await this.request(pathname, { method: "DELETE" });
  }

  private async request<T>(
    pathname: string,
    init: { method: string; query?: Record<string, unknown>; body?: unknown },
  ): Promise<T> {
    if (!this.baseUrl) {
      throw new Error("PocketBase client has not been connected.");
    }

    const url = new URL(pathname, `${this.baseUrl}/`);
    if (init.query) {
      for (const [key, value] of Object.entries(init.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await fetch(url, {
      method: init.method,
      headers: {
        Accept: "application/json",
        ...(this.token ? { Authorization: this.token } : {}),
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

    if (response.status === 204) {
      return undefined as T;
    }

    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const code = extractErrorCode(payload);
      throw new PocketBaseRequestError(
        payload?.message ?? response.statusText,
        response.status,
        code,
        payload?.data,
      );
    }

    return payload as T;
  }
}

function extractErrorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  // PB surfaces field-level error codes nested under data
  const data = p["data"];
  if (data && typeof data === "object") {
    const first = Object.values(data as Record<string, unknown>)[0];
    if (first && typeof first === "object") {
      const code = (first as Record<string, unknown>)["code"];
      if (typeof code === "string") return code;
    }
  }
  return undefined;
}
