import type { AdapterConfig } from "./types.js";
import { OsmRequestError } from "./types.js";

const DEFAULT_API_URL = "https://api.openstreetmap.org";
const DEFAULT_SEARCH_URL = "https://nominatim.openstreetmap.org";
const USER_AGENT = "skeem-osm-adapter/0.6.0 (https://github.com/ambirex/skeem)";

/**
 * Read-only client for OpenStreetMap. Element lookups go to the main OSM API
 * (`connection.url`); name search goes to Nominatim (`connection.searchUrl`,
 * overridable to a self-hosted instance — the documented escape hatch from the
 * public usage policy). Both public endpoints expect ≤1 request/second and an
 * identifying User-Agent; the client enforces a min interval in-process.
 */
export class OsmClient {
  private apiUrl = DEFAULT_API_URL;
  private searchUrl = DEFAULT_SEARCH_URL;
  private lastRequestAt = 0;

  constructor(private readonly minIntervalMs = 1000) {}

  connect(config: AdapterConfig): void {
    this.apiUrl = (config.url ? String(config.url) : DEFAULT_API_URL).replace(/\/+$/, "");
    this.searchUrl = (typeof config["searchUrl"] === "string" && config["searchUrl"].length > 0
      ? config["searchUrl"]
      : DEFAULT_SEARCH_URL
    ).replace(/\/+$/, "");
  }

  element<T>(pathname: string): Promise<T> {
    return this.request<T>(`${this.apiUrl}${pathname}`);
  }

  search<T>(query: Record<string, string | number>): Promise<T> {
    const url = new URL(`${this.searchUrl}/search`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
    return this.request<T>(url.toString());
  }

  private async request<T>(target: string): Promise<T> {
    await this.throttle();

    const response = await fetch(target, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });

    if (!response.ok) {
      if (response.status === 410) {
        throw new OsmRequestError("The element has been deleted from OpenStreetMap.", 410);
      }
      const body = await response.text().catch(() => "");
      throw new OsmRequestError(body.trim() || response.statusText, response.status);
    }

    const payload = (await response.json().catch(() => undefined)) as T | undefined;
    if (payload === undefined) {
      throw new OsmRequestError("OpenStreetMap returned an unparseable response.", 502);
    }
    return payload;
  }

  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) {
      return;
    }
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastRequestAt = Date.now();
  }
}
