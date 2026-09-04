// End-to-end smoke test of the built MCP server over stdio, using the in-memory
// transport. Verifies the JSON-RPC handshake, tool registration, and that a few
// tool calls work and that errors surface as tool errors rather than crashes.
//
//   npm run build && npm run smoke
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
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

const child = spawn(process.execPath, [join(root, "dist", "index.js")], {
  cwd: dir,
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, TEAM_RELAY_LOG_LEVEL: "warn" },
});

let buf = "";
const pending = new Map();
child.stdout.on("data", (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let id = 0;
const rpc = (method, params) =>
  new Promise((resolve) => {
    const thisId = ++id;
    pending.set(thisId, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: thisId, method, params }) + "\n");
  });
const notify = (method, params) =>
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
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
  const names = (tools.result?.tools ?? []).map((t) => t.name).sort();
  check(
    ["ack", "ask_team", "ask_teammate", "post_note", "record_decision", "reply", "team_sync"].every(
      (n) => names.includes(n),
    ),
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

  const dec = await rpc("tools/call", {
    name: "record_decision",
    arguments: { topic: "smoke", decision: "works" },
  });
  check((dec.result?.content?.[0]?.text ?? "").includes("Recorded"), "record_decision");
} finally {
  child.stdin.end();
  child.kill();
  await new Promise((r) => child.once("exit", r)).catch(() => {});
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* temp dir cleanup is best-effort */
  }
}

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log("\nsmoke ok");
