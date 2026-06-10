import type { AdapterConfig, TmdbErrorBody } from "./types.js";
import { TmdbRequestError } from "./types.js";

const DEFAULT_URL = "https://api.themoviedb.org/3";
const USER_AGENT = "skeem-tmdb-adapter/0.6.0 (https://github.com/ambirex/skeem)";

/**
 * Read-only client for the TMDB v3 API. One `connection.token` covers both
 * auth schemes: a v4 Read Access Token (a JWT starting "eyJ") is sent as a
 * Bearer header; a v3 key (32-char hex) goes in the `api_key` query param;
 * anything else defaults to Bearer. Connect stays offline — a missing token
 * fails with an auth error at the first request.
 */
export class TmdbClient {
  private baseUrl = DEFAULT_URL;
  private token?: string;

  connect(config: AdapterConfig): void {
    this.baseUrl = (config.url ? String(config.url) : DEFAULT_URL).replace(/\/+$/, "");
    this.token = config.token ? String(config.token) : undefined;
  }

  async get<T>(pathname: string, query?: Record<string, string | number>): Promise<T> {
    if (!this.token) {
      throw new TmdbRequestError(
        "TMDB requires an API token. Set connection.token (a v4 Read Access Token or a v3 API key) — get one at https://www.themoviedb.org/settings/api.",
        401,
        7,
      );
    }

    const url = new URL(`${this.baseUrl}${pathname}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }

    const isV3Key = /^[a-f0-9]{32}$/i.test(this.token);
    if (isV3Key) {
      url.searchParams.set("api_key", this.token);
    }

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...(isV3Key ? {} : { Authorization: `Bearer ${this.token}` }),
      },
    });

    const payload = (await response.json().catch(() => undefined)) as
      | (T & TmdbErrorBody)
      | undefined;

    if (!response.ok) {
      const statusCode = payload?.status_code;
      let message = payload?.status_message ?? response.statusText;
      if (statusCode === 7 || statusCode === 10) {
        message += " (check whether connection.token is a v4 Read Access Token or a v3 API key)";
      }
      throw new TmdbRequestError(message, response.status, statusCode);
    }
    if (!payload) {
      throw new TmdbRequestError("TMDB returned an unparseable response.", 502);
    }

    return payload as T;
  }
}
