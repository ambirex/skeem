#!/usr/bin/env node

// Copy the repo's agent-facing files into site/public so the site can serve
// them at its domain root (llms.txt convention + the SKILL.md playbook), and
// copy the social image for og:image. Relative links in the markdown are
// rewritten to absolute GitHub URLs so they resolve when served from the site.
//
// Run as part of `npm run site:capture`, or standalone: node site/capture/sync-agent-files.mjs

import { copyFile, mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = path.join(repoRoot, "site", "public");
const BLOB = "https://github.com/ambirex/skeem/blob/main";

// Rewrite relative markdown/inline links (not http, not anchors) to absolute repo URLs.
function absolutize(md) {
  return md.replace(/\]\((?!https?:|#|\/)([^)]+)\)/g, (_m, target) => `](${BLOB}/${target})`);
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function syncMarkdown(name) {
  const src = path.join(repoRoot, name);
  if (!(await exists(src))) return;
  await writeFile(path.join(publicDir, name), absolutize(await readFile(src, "utf8")));
  console.log(`  synced ${name}`);
}

async function main() {
  await syncMarkdown("llms.txt");
  await syncMarkdown("SKILL.md");

  const ogSrc = path.join(repoRoot, "docs", "assets", "skeem-social.png");
  if (await exists(ogSrc)) {
    await mkdir(path.join(publicDir, "og"), { recursive: true });
    await copyFile(ogSrc, path.join(publicDir, "og", "skeem-social.png"));
    console.log("  synced og/skeem-social.png");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
