// Run the same MCP stdio smoke checks against the production container image.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSmoke } from "./smoke.mjs";

const image = process.argv[2];
if (!image) throw new Error("usage: node scripts/docker-smoke.mjs <image>");

const help = execFileSync("docker", ["run", "--rm", image, "--help"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
if (!help.includes("a relay for teammates' separate Claude Code sessions")) {
  throw new Error("container CLI did not print the expected help text");
}
console.log("PASS  container CLI help");

const userArgs =
  typeof process.getuid === "function" && typeof process.getgid === "function"
    ? ["--user", `${process.getuid()}:${process.getgid()}`]
    : [];

const snippetDir = mkdtempSync(join(tmpdir(), "team-relay-docker-snippet-"));
try {
  const result = execFileSync(
    "docker",
    [
      "run",
      "--rm",
      ...userArgs,
      "--mount",
      `type=bind,source=${snippetDir},target=/workspace`,
      "--entrypoint",
      "node",
      image,
      "--input-type=module",
      "--eval",
      "import { appendClaudeMd } from '/app/dist/cli/setup-io.js'; " +
        "console.log(appendClaudeMd('/workspace'));",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const claudeMd = readFileSync(join(snippetDir, "CLAUDE.md"), "utf8");
  if (result.trim() !== "appended" || !claudeMd.includes("team-relay")) {
    throw new Error("container setup could not append the bundled Claude guidance");
  }
  console.log("PASS  container setup guidance");
} finally {
  rmSync(snippetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

await runSmoke((fixtureDir) => {
  const args = ["run", "--rm", "-i", "--network", "none"];
  args.push(...userArgs);
  args.push(
    "--mount",
    `type=bind,source=${fixtureDir},target=/workspace`,
    "--env",
    "TEAM_RELAY_LOG_LEVEL=warn",
    image,
  );
  return spawn("docker", args, { stdio: ["pipe", "pipe", "inherit"] });
});
