import type { AdapterConfig } from "./types.js";
import { DirectusRequestError } from "./types.js";

export class DirectusClient {
  private config?: AdapterConfig;

  async connect(config: AdapterConfig): Promise<void> {
    this.config = {
      ...config,
      url: config.url.replace(/\/+$/, ""),
    };
  }

  async get<T>(pathname: string, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>(pathname, {
      method: "GET",
      ...(query ? { query } : {}),
    });
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
    init: {
      method: string;
      query?: Record<string, unknown>;
      body?: unknown;
    },
  ): Promise<T> {
    if (!this.config) {
      throw new Error("Directus client has not been connected.");
    }

    const url = new URL(pathname, `${this.config.url}/`);
    if (init.query) {
      appendSearchParams(url.searchParams, init.query);
    }

    const response = await fetch(url, {
      method: init.method,
      headers: {
        Accept: "application/json",
        ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

    if (response.status === 204) {
      return undefined as T;
    }

    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = Array.isArray(payload?.errors) ? payload.errors[0] : undefined;
      throw new DirectusRequestError(
        error?.message ?? response.statusText,
        response.status,
        error?.extensions?.code,
        error?.extensions,
      );
    }

    return payload as T;
  }
}

function appendSearchParams(searchParams: URLSearchParams, value: Record<string, unknown>, prefix?: string): void {
  for (const [key, entry] of Object.entries(value)) {
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (entry === undefined) {
      continue;
    }
    if (entry === null) {
      searchParams.append(paramKey, "null");
      continue;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) {
        searchParams.append(paramKey, String(item));
      }
      continue;
    }
    if (typeof entry === "object") {
      appendSearchParams(searchParams, entry as Record<string, unknown>, paramKey);
      continue;
    }
    searchParams.append(paramKey, String(entry));
  }
}
