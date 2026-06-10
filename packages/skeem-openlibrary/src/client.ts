import type { AdapterConfig } from "./types.js";
import { OpenLibraryRequestError } from "./types.js";

const DEFAULT_URL = "https://openlibrary.org";
const USER_AGENT = "skeem-openlibrary-adapter/0.6.0 (https://github.com/ambirex/skeem)";

/** Read-only client for openlibrary.org. No auth; descriptive User-Agent. */
export class OpenLibraryClient {
  private baseUrl = DEFAULT_URL;

  connect(config: AdapterConfig): void {
    this.baseUrl = (config.url ? String(config.url) : DEFAULT_URL).replace(/\/+$/, "");
  }

  /**
   * GET a JSON resource. Returns undefined on 404 so callers can decide between
   * not_found and an empty find result. Redirects (e.g. /isbn/… -> /books/…)
   * are followed by fetch.
   */
  async get<T>(pathname: string, query?: Record<string, string | number>): Promise<T | undefined> {
    const url = new URL(`${this.baseUrl}${pathname}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });

    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new OpenLibraryRequestError(body.trim() || response.statusText, response.status);
    }

    const payload = (await response.json().catch(() => undefined)) as T | undefined;
    if (payload === undefined) {
      throw new OpenLibraryRequestError("Open Library returned an unparseable response.", 502);
    }
    return payload;
  }
}
