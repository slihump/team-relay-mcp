// Run the same MCP stdio smoke checks against the production container image.
import { execFileSync, spawn } from "node:child_process";
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

await runSmoke((fixtureDir) => {
  const args = ["run", "--rm", "-i", "--network", "none"];
  if (typeof process.getuid === "function" && typeof process.getgid === "function") {
    args.push("--user", `${process.getuid()}:${process.getgid()}`);
  }
  args.push(
    "--mount",
    `type=bind,source=${fixtureDir},target=/workspace`,
    "--env",
    "TEAM_RELAY_LOG_LEVEL=warn",
    image,
  );
  return spawn("docker", args, { stdio: ["pipe", "pipe", "inherit"] });
});
