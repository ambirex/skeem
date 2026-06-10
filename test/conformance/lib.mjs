import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";

export function runCommand(command, args, options = {}) {
  return spawnSync(command, args, { ...options, encoding: "utf8" });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function exists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Poll an HTTP endpoint until it responds OK or the deadline passes. `check`
 * receives the Response and returns a boolean; defaults to `res.ok`.
 */
export async function waitForHttp(url, { headers = {}, timeoutMs = 90_000, check } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers });
      if (check ? await check(response) : response.ok) {
        return;
      }
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = String(error);
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${url} (${lastError}).`);
}
