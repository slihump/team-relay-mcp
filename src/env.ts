/**
 * Load `.env` before anything else. `quiet: true` matters: dotenv otherwise
 * prints a notice to stdout, which would corrupt the MCP stdio stream.
 *
 * Import this module for its side effect, first, in every entrypoint.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { resolveConfigDir } from "./config.js";

const candidates = [join(process.cwd(), ".env"), join(resolveConfigDir(), ".env")];

for (const path of candidates) {
  if (existsSync(path)) {
    dotenvConfig({ path, quiet: true, override: false });
  }
}
