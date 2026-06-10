import type { AdapterConfig } from "./types.js";
import { StrapiRequestError } from "./types.js";

/**
 * Strapi splits auth into two systems: a Bearer **API token** for the public
 * `/api/*` data routes, and an **admin JWT** for `/admin/*` and the
 * content-type-builder (introspection). The client holds both — the admin JWT
 * is fetched lazily from email/password the first time introspection runs.
 */
export class StrapiClient {
  private baseUrl?: string;
  private apiToken?: string;
  private adminToken?: string;
  private adminEmail?: string;
  private adminPassword?: string;

  connect(config: AdapterConfig): void {
    this.baseUrl = config.url.replace(/\/+$/, "");
    this.apiToken = config.token ? String(config.token) : undefined;
    this.adminToken = typeof config["adminToken"] === "string" ? config["adminToken"] : undefined;
    this.adminEmail = typeof config["email"] === "string" ? config["email"] : undefined;
    this.adminPassword = typeof config["password"] === "string" ? config["password"] : undefined;
  }

  /** A request against the public data API, authenticated with the API token. */
  data<T>(
    method: string,
    pathname: string,
    init: { query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<T> {
    return this.request<T>(method, pathname, { ...init, token: this.apiToken });
  }

  /** A GET against an admin route (content-type-builder), using the admin JWT. */
  async adminGet<T>(pathname: string): Promise<T> {
    const token = await this.ensureAdminToken();
    return this.request<T>("GET", pathname, { token });
  }

  private async ensureAdminToken(): Promise<string> {
    if (this.adminToken) {
      return this.adminToken;
    }
    if (!this.adminEmail || !this.adminPassword) {
      throw new StrapiRequestError(
        "Strapi schema introspection needs admin credentials. Set connection.email and connection.password (or connection.adminToken).",
        401,
      );
    }
    const payload = await this.request<{ data?: { token?: string } }>("POST", "/admin/login", {
      body: { email: this.adminEmail, password: this.adminPassword },
      noAuth: true,
    });
    const token = payload?.data?.token;
    if (!token) {
      throw new StrapiRequestError("Strapi admin login did not return a token.", 401);
    }
    this.adminToken = token;
    return token;
  }

  private async request<T>(
    method: string,
    pathname: string,
    init: { query?: Record<string, unknown>; body?: unknown; token?: string; noAuth?: boolean },
  ): Promise<T> {
    if (!this.baseUrl) {
      throw new Error("Strapi client has not been connected.");
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
      method,
      headers: {
        Accept: "application/json",
        ...(init.noAuth || !init.token ? {} : { Authorization: `Bearer ${init.token}` }),
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

    if (response.status === 204) {
      return undefined as T;
    }

    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = payload?.error;
      throw new StrapiRequestError(
        error?.message ?? payload?.message ?? response.statusText,
        response.status,
        error?.name,
        error?.details,
      );
    }

    return payload as T;
  }
}
