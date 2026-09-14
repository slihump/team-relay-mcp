// End-to-end smoke test of an MCP server over stdio, using the in-memory
// transport. Verifies the JSON-RPC handshake, tool registration, representative
// tool calls, and readable tool errors.
//
//   npm run smoke
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function runSmoke(spawnServer) {
  const dir = mkdtempSync(join(tmpdir(), "team-relay-smoke-"));
  mkdirSync(join(dir, ".team-relay"));
  writeFileSync(
    join(dir, ".team-relay", "team.json"),
    JSON.stringify(
      {
        me: "alice",
        channelId: "smoke",
        teammates: [
          { name: "alice", id: "alice-id" },
          { name: "bob", id: "bob-id" },
        ],
        decisionsFile: "TEAM-DECISIONS.md",
        transport: "memory",
      },
      null,
      2,
    ),
  );

  const child = spawnServer(dir);
  let buf = "";
  const pending = new Map();

  const failPending = (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  child.on("error", failPending);
  child.on("exit", (code, signal) => {
    if (pending.size > 0) {
      failPending(new Error(`MCP server exited before replying (code=${code}, signal=${signal})`));
    }
  });
  child.stdout.on("data", (data) => {
    buf += data.toString();
    let newline;
    while ((newline = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, newline).trim();
      buf = buf.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        failPending(new Error(`MCP server emitted invalid JSON: ${line}`, { cause: error }));
        continue;
      }
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id);
        clearTimeout(request.timeout);
        request.resolve(message);
        pending.delete(message.id);
      }
    }
  });

  let id = 0;
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const thisId = ++id;
      const timeout = setTimeout(() => {
        pending.delete(thisId);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 10_000);
      pending.set(thisId, { resolve, reject, timeout });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: thisId, method, params }) + "\n",
        (error) => {
          if (!error) return;
          clearTimeout(timeout);
          pending.delete(thisId);
          reject(error);
        },
      );
    });
  const notify = (method, params) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

  let failures = 0;
  const check = (condition, label) => {
    console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
    if (!condition) failures++;
  };

  try {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "smoke", version: "0" },
    });
    check(init.result?.serverInfo?.name === "team-relay", "initialize");
    notify("notifications/initialized");

    const tools = await rpc("tools/list", {});
    const names = (tools.result?.tools ?? []).map((tool) => tool.name).sort();
    check(
      [
        "ack",
        "ask_team",
        "ask_teammate",
        "post_note",
        "record_decision",
        "reply",
        "team_sync",
      ].every((name) => names.includes(name)),
      `tools/list (${names.join(", ")})`,
    );

    const sync = await rpc("tools/call", { name: "team_sync", arguments: {} });
    check(
      (sync.result?.content?.[0]?.text ?? "").includes("nothing needs your attention"),
      "team_sync empty digest",
    );

    const ask = await rpc("tools/call", {
      name: "ask_teammate",
      arguments: { to: "bob", question: "smoke?", context: "ctx" },
    });
    check(
      /conversation_id=[a-z0-9]{8}/.test(ask.result?.content?.[0]?.text ?? ""),
      "ask_teammate returns a conversation id",
    );

    const bad = await rpc("tools/call", {
      name: "ask_teammate",
      arguments: { to: "ghost", question: "x" },
    });
    check(bad.result?.isError === true, "ask_teammate(unknown) surfaces a tool error");

    const decision = await rpc("tools/call", {
      name: "record_decision",
      arguments: { topic: "smoke", decision: "works" },
    });
    check((decision.result?.content?.[0]?.text ?? "").includes("Recorded"), "record_decision");
  } finally {
    for (const request of pending.values()) clearTimeout(request.timeout);
    pending.clear();
    child.stdin.end();
    if (child.exitCode === null) child.kill();
    if (child.exitCode === null) {
      await new Promise((resolve) => child.once("exit", resolve)).catch(() => {});
    }
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* temp dir cleanup is best-effort */
    }
  }

  if (failures > 0) {
    throw new Error(`${failures} smoke check(s) failed`);
  }
  console.log("\nsmoke ok");
}

function spawnLocalServer(fixtureDir) {
  return spawn(process.execPath, [join(root, "dist", "index.js")], {
    cwd: fixtureDir,
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, TEAM_RELAY_LOG_LEVEL: "warn" },
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await runSmoke(spawnLocalServer);
