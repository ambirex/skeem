import type { AdapterConfig } from "./types.js";
import { CrossRefRequestError } from "./types.js";

const DEFAULT_URL = "https://api.crossref.org";

/**
 * Read-only client for the CrossRef REST API. Setting `connection.mailto` opts
 * into CrossRef's "polite pool" (better rate limits): the address is appended
 * as a query param and advertised in the User-Agent. Error bodies are sometimes
 * plain text, so non-JSON responses on failure are tolerated.
 */
export class CrossRefClient {
  private baseUrl = DEFAULT_URL;
  private mailto?: string;

  connect(config: AdapterConfig): void {
    this.baseUrl = (config.url ? String(config.url) : DEFAULT_URL).replace(/\/+$/, "");
    this.mailto = typeof config["mailto"] === "string" && config["mailto"].length > 0
      ? config["mailto"]
      : undefined;
  }

  async get<T>(pathname: string, query?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${this.baseUrl}${pathname}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    if (this.mailto) {
      url.searchParams.set("mailto", this.mailto);
    }

    const userAgent = this.mailto
      ? `skeem-crossref-adapter/0.6.0 (https://github.com/ambirex/skeem; mailto:${this.mailto})`
      : "skeem-crossref-adapter/0.6.0 (https://github.com/ambirex/skeem)";

    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": userAgent },
    });

    if (!response.ok) {
      // CrossRef 404 bodies are often plain text ("Resource not found.").
      const body = await response.text().catch(() => "");
      if (response.status === 404) {
        throw new CrossRefRequestError(
          "Not found in CrossRef (the DOI may be registered with another agency such as DataCite).",
          404,
        );
      }
      if (response.status === 429) {
        throw new CrossRefRequestError(
          "CrossRef rate limit hit — set connection.mailto to join the polite pool, and slow down.",
          429,
        );
      }
      throw new CrossRefRequestError(body.trim() || response.statusText, response.status);
    }

    const payload = (await response.json().catch(() => undefined)) as T | undefined;
    if (payload === undefined) {
      throw new CrossRefRequestError("CrossRef returned an unparseable response.", 502);
    }
    return payload;
  }
}
