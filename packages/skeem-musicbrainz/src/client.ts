import type { AdapterConfig } from "./types.js";
import { MusicBrainzRequestError } from "./types.js";

const DEFAULT_URL = "https://musicbrainz.org";
const USER_AGENT = "skeem-musicbrainz-adapter/0.6.0 (https://github.com/ambirex/skeem)";

/**
 * Read-only client for the MusicBrainz WS/2 API. MusicBrainz requires a
 * descriptive User-Agent and allows roughly one request per second per client —
 * the client enforces a min-interval between requests in-process (the smoke
 * scripts space their own calls, since each CLI run is a separate process).
 */
export class MusicBrainzClient {
  private baseUrl = DEFAULT_URL;
  private lastRequestAt = 0;

  constructor(private readonly minIntervalMs = 1000) {}

  connect(config: AdapterConfig): void {
    this.baseUrl = (config.url ? String(config.url) : DEFAULT_URL).replace(/\/+$/, "");
  }

  async get<T>(pathname: string, query?: Record<string, string | number>): Promise<T> {
    await this.throttle();

    const url = new URL(`${this.baseUrl}${pathname}`);
    url.searchParams.set("fmt", "json");
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });

    const payload = (await response.json().catch(() => undefined)) as
      | (T & { error?: string })
      | undefined;

    if (!response.ok) {
      const message = payload?.error ?? response.statusText;
      if (response.status === 503) {
        throw new MusicBrainzRequestError(
          "MusicBrainz rate limit hit (the API allows ~1 request/second) — retry after a pause.",
          503,
        );
      }
      throw new MusicBrainzRequestError(message, response.status);
    }
    if (!payload) {
      throw new MusicBrainzRequestError("MusicBrainz returned an unparseable response.", 502);
    }

    return payload as T;
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
