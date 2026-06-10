import type { AdapterConfig } from "./types.js";
import { WikiDataRequestError } from "./types.js";

const DEFAULT_URL = "https://www.wikidata.org";
const USER_AGENT = "skeem-wikidata-adapter (https://github.com/ambirex/skeem)";

/**
 * Read-only client for the MediaWiki Action API (`/w/api.php`). WikiData needs
 * no auth for reads; a descriptive User-Agent is sent per Wikimedia etiquette.
 * The Action API returns HTTP 200 with an `error` object on failure, so callers
 * must check the parsed body.
 */
export class WikiDataClient {
  private apiUrl = `${DEFAULT_URL}/w/api.php`;

  connect(config: AdapterConfig): void {
    const base = (config.url ? String(config.url) : DEFAULT_URL).replace(/\/+$/, "");
    // Accept either a wiki root (…/wikidata.org) or a full api.php URL.
    this.apiUrl = base.endsWith("/w/api.php") || base.endsWith("/api.php")
      ? base
      : `${base}/w/api.php`;
  }

  async get<T>(params: Record<string, string | number>): Promise<T> {
    const url = new URL(this.apiUrl);
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });

    if (!response.ok) {
      throw new WikiDataRequestError(`WikiData request failed: ${response.statusText}`, response.status);
    }

    const payload = (await response.json().catch(() => undefined)) as
      | (T & { error?: { code?: string; info?: string } })
      | undefined;

    if (!payload) {
      throw new WikiDataRequestError("WikiData returned an unparseable response.", 502);
    }
    if (payload.error) {
      // MediaWiki signals errors in-band with HTTP 200.
      throw new WikiDataRequestError(payload.error.info ?? "WikiData API error", 400, payload.error.code);
    }

    return payload as T;
  }
}
