#!/usr/bin/env node
import "../env.js";
import { log } from "../logger.js";

const HELP = `team-relay-mcp — a relay for teammates' separate Claude Code sessions

Usage:
  team-relay-mcp [serve]   Run the MCP server on stdio (default; this is what .mcp.json calls)
  team-relay-mcp init      Interactive setup: write team.json / .env, print the .mcp.json entry
  team-relay-mcp doctor    Check the config and the Discord connection
  team-relay-mcp --help    Show this help
`;

async function run(): Promise<number> {
  const cmd = process.argv[2] ?? "serve";

  switch (cmd) {
    case "-h":
    case "--help":
    case "help":
      process.stdout.write(HELP);
      return 0;

    case "init": {
      const { runInit } = await import("./init.js");
      return runInit();
    }

    case "doctor": {
      const { runDoctor } = await import("./doctor.js");
      return runDoctor();
    }

    case "serve": {
      const { main } = await import("../index.js");
      await main();
      return typeof process.exitCode === "number" ? process.exitCode : 0;
    }

    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
      return 2;
  }
}

run().then(
  (code) => {
    if (code) process.exitCode = code;
  },
  (err) => {
    log.error("fatal", err);
    process.exitCode = 1;
  },
);
