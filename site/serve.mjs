#!/usr/bin/env node

// Zero-dependency static server for local site development (npm run site:dev).
// Serves site/public exactly as Cloudflare Pages will. Not used in production.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const port = Number(process.env.PORT ?? 8788);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";

    let filePath = path.join(root, pathname);
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    let info = await stat(filePath).catch(() => undefined);
    if (!info?.isFile()) {
      // SPA-ish fallback: serve index.html for unknown routes.
      filePath = path.join(root, "index.html");
      info = await stat(filePath).catch(() => undefined);
      if (!info?.isFile()) {
        res.writeHead(404).end("Not found");
        return;
      }
    }

    res.writeHead(200, { "Content-Type": TYPES[path.extname(filePath)] ?? "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});

server.listen(port, () => {
  console.log(`skeem site → http://localhost:${port}`);
});
