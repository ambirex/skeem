import type { MbUrlRelation } from "./types.js";

export interface ExtractedLinks {
  externalIds: Record<string, string[]>;
  links: Record<string, string[]>;
}

/**
 * Turn MusicBrainz URL relationships into the shared externalIds vocabulary
 * (docs/reference/external-ids.md). Only relations with a canonical bare id are
 * normalized — wikidata (Q-id from the URL), IMDb, VIAF — plus the URL-valued
 * `official_website`/`wikipedia` keys; everything else (discogs, allmusic,
 * last.fm, …) stays as raw URLs under `links`, keyed by the MB relation type.
 * Top-level `isnis` ride along as `isni`.
 */
export function extractLinkRelations(
  relations: MbUrlRelation[] | undefined,
  isnis?: string[],
): ExtractedLinks {
  const externalIds: Record<string, Set<string>> = {};
  const links: Record<string, Set<string>> = {};

  const add = (target: Record<string, Set<string>>, key: string, value: string) => {
    (target[key] ??= new Set()).add(value);
  };

  for (const relation of relations ?? []) {
    const url = relation.url?.resource;
    const type = relation.type;
    if (!url || !type) continue;

    switch (type) {
      case "wikidata": {
        const match = /\/(Q\d+)(?:[/#?]|$)/.exec(url);
        if (match) add(externalIds, "wikidata", match[1]!);
        break;
      }
      case "IMDb":
      case "imdb": {
        const match = /\b((?:tt|nm|co|ch)\d+)\b/.exec(url);
        if (match) add(externalIds, "imdb", match[1]!.toLowerCase());
        break;
      }
      case "VIAF":
      case "viaf": {
        const match = /(\d+)\/?$/.exec(url);
        if (match) add(externalIds, "viaf", match[1]!);
        break;
      }
      case "official homepage":
        add(externalIds, "official_website", url);
        break;
      case "wikipedia":
        add(externalIds, "wikipedia", url);
        break;
      default:
        add(links, type, url);
    }
  }

  for (const isni of isnis ?? []) {
    const cleaned = String(isni).replace(/\s+/g, "");
    if (cleaned) add(externalIds, "isni", cleaned);
  }

  return {
    externalIds: Object.fromEntries(Object.entries(externalIds).map(([k, v]) => [k, [...v]])),
    links: Object.fromEntries(Object.entries(links).map(([k, v]) => [k, [...v]])),
  };
}
