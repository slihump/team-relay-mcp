// Verify the public npm artifact from a consumer's point of view. This checks
// both the dry-run manifest and an installed tarball without publishing it.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npmExecPath = process.env.npm_execpath;
const required = new Set([
  "LICENSE",
  "README.md",
  "dist/cli/main.js",
  "dist/index.js",
  "docs/claude-md-snippet.md",
  "package.json",
]);
const forbiddenPrefixes = [".env", ".team-relay/", "conversation-logs/", "src/", "test/"];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function runNpm(args, options = {}) {
  if (npmExecPath) return run(process.execPath, [npmExecPath, ...args], options);
  if (process.platform !== "win32") return run("npm", args, options);
  throw new Error("run this check through `npm run package:check` on Windows");
}

function packResult(stdout, operation) {
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed) || !parsed[0]) {
    throw new Error(`${operation} returned no package information`);
  }
  return parsed[0];
}

function isolatedNpmEnv(userconfig) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^npm_config_(allow_scripts|userconfig)$/i.test(key)) delete env[key];
  }
  env.NPM_CONFIG_USERCONFIG = userconfig;
  return env;
}

const dryRun = packResult(
  runNpm(["pack", "--dry-run", "--json", "--ignore-scripts"]),
  "npm pack --dry-run",
);
const paths = new Set(dryRun.files.map((file) => file.path));

const missing = [...required].filter((path) => !paths.has(path));
if (missing.length > 0) {
  throw new Error(`npm package is missing required files: ${missing.join(", ")}`);
}

const forbidden = [...paths].filter((path) =>
  forbiddenPrefixes.some((prefix) => path === prefix || path.startsWith(prefix)),
);
if (forbidden.length > 0) {
  throw new Error(`npm package contains private/development files: ${forbidden.join(", ")}`);
}

const temp = mkdtempSync(join(tmpdir(), "team-relay-package-"));
try {
  const cleanNpmConfig = join(temp, "empty.npmrc");
  writeFileSync(cleanNpmConfig, "");
  const packed = packResult(
    runNpm(["pack", "--json", "--ignore-scripts", "--pack-destination", temp]),
    "npm pack",
  );
  const tarball = join(temp, packed.filename);
  const consumer = join(temp, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "team-relay-package-smoke", private: true }),
  );
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
    cwd: consumer,
    env: isolatedNpmEnv(cleanNpmConfig),
  });

  const cli = join(consumer, "node_modules", "team-relay-mcp", "dist", "cli", "main.js");
  const help = run(process.execPath, [cli, "--help"], { cwd: consumer });
  if (!help.includes("a relay for teammates' separate Claude Code sessions")) {
    throw new Error("installed CLI did not print the expected help text");
  }

  console.log(`PASS  npm pack contents (${paths.size} files)`);
  console.log(`PASS  installed team-relay-mcp@${dryRun.version} CLI`);
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
