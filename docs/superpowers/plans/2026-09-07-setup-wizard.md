# Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the linear `team-relay-mcp init` prompts with a terminal wizard that discovers the Discord server and channel from the bot's own token, so no one has to transcribe a snowflake id again.

**Architecture:** A pure model (`wizard/steps.ts`) holds validation and the review-screen state; an imperative shell (`wizard/run.ts`) drives it with `@inquirer/prompts` and Discord probes. File writing moves to a shared `setup-io.ts` used by both the wizard and the existing linear flow, which survives as the non-TTY fallback.

**Tech Stack:** TypeScript (ESM, `NodeNext`), Node >= 20, vitest, `@inquirer/prompts`, `@discordjs/rest`, `discord-api-types`.

**Spec:** `docs/superpowers/specs/2026-09-07-gui-setup-wizard-design.md`

## Global Constraints

- Node `>= 20` (`package.json` `engines`); local dev pinned to 24 by `.node-version`.
- ESM only. Every relative import ends in `.js`, even from `.ts` sources.
- Runtime dependencies stay minimal. This plan adds exactly one: `@inquirer/prompts`.
- Prettier is enforced by `npm run format:check` in CI. Run `npm run format` before committing.
- `NAME_RE` is `/^[a-z0-9][a-z0-9_-]{0,31}$/i`; `SNOWFLAKE_RE` is `/^\d{15,25}$/`.
- Discord invite permissions integer is `68608` (VIEW_CHANNEL 1024 + SEND_MESSAGES 2048 + READ_MESSAGE_HISTORY 65536).
- `channelId` stays a plain string in the config schema so `transport: "memory"` keeps working. Validation belongs to setup, never to `config.ts`.
- Never log a bot token.

---

### Task 1: Extract shared setup I/O

Both the wizard and the fallback must write identical files. Extract that writing now, before a second caller exists.

**Files:**

- Create: `src/cli/setup-io.ts`
- Modify: `src/cli/init.ts` (delete the inlined writing, import it instead)
- Test: `test/setup-io.test.ts`

**Interfaces:**

- Consumes: `TeamFile` from `../config.js`.
- Produces:
  - `resolveSetupDir(cwd: string): string`
  - `writeTeamFiles(configDir: string, team: TeamFile, token: string): { teamPath: string; envPath: string }`
  - `mcpEntry(cwd: string, configDir: string): object`
  - `appendClaudeMd(cwd: string): "appended" | "already-present" | "snippet-missing"`
  - `relPath(from: string, to: string): string`

- [ ] **Step 1: Write the failing test**

Create `test/setup-io.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TeamFile } from "../src/config.js";
import { appendClaudeMd, mcpEntry, relPath, writeTeamFiles } from "../src/cli/setup-io.js";

const TEAM: TeamFile = {
  me: "alice",
  channelId: "1546378169722994720",
  teammates: [{ name: "alice", id: "1546373827578167447" }],
  decisionsFile: "TEAM-DECISIONS.md",
  transport: "discord",
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "team-relay-setup-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("writeTeamFiles", () => {
  it("writes team.json and .env, creating the directory", () => {
    const cfg = join(dir, ".team-relay");
    const { teamPath, envPath } = writeTeamFiles(cfg, TEAM, "tok-123");

    expect(JSON.parse(readFileSync(teamPath, "utf8"))).toEqual(TEAM);
    expect(readFileSync(envPath, "utf8")).toBe("DISCORD_BOT_TOKEN=tok-123\n");
  });

  it("keeps the token file private", () => {
    const cfg = join(dir, ".team-relay");
    const { envPath } = writeTeamFiles(cfg, TEAM, "tok-123");
    if (process.platform === "win32") return; // POSIX modes only
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
  });

  it("tightens the mode even when .env already exists loosely", () => {
    const cfg = join(dir, ".team-relay");
    writeTeamFiles(cfg, TEAM, "first");
    writeFileSync(join(cfg, ".env"), "DISCORD_BOT_TOKEN=stale\n", { mode: 0o644 });

    const { envPath } = writeTeamFiles(cfg, TEAM, "second");
    expect(readFileSync(envPath, "utf8")).toBe("DISCORD_BOT_TOKEN=second\n");
    if (process.platform === "win32") return;
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
  });
});

describe("mcpEntry", () => {
  it("points TEAM_RELAY_CONFIG_DIR at the config dir, relative to cwd", () => {
    expect(mcpEntry("/repo", "/repo/.team-relay")).toEqual({
      mcpServers: {
        "team-relay": {
          command: "npx",
          args: ["-y", "team-relay-mcp"],
          env: { TEAM_RELAY_CONFIG_DIR: ".team-relay" },
        },
      },
    });
  });

  it("falls back to '.' when the config dir is the cwd", () => {
    const entry = mcpEntry("/repo", "/repo") as {
      mcpServers: { "team-relay": { env: { TEAM_RELAY_CONFIG_DIR: string } } };
    };
    expect(entry.mcpServers["team-relay"].env.TEAM_RELAY_CONFIG_DIR).toBe(".");
  });
});

describe("relPath", () => {
  it("uses forward slashes and keeps absolute paths that escape cwd", () => {
    expect(relPath("/repo", "/repo/a/b")).toBe("a/b");
    expect(relPath("/repo", "/elsewhere")).toBe("/elsewhere");
  });
});

describe("appendClaudeMd", () => {
  it("creates CLAUDE.md when absent", () => {
    expect(appendClaudeMd(dir)).toBe("appended");
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toContain("team-relay");
  });

  it("does not append twice", () => {
    appendClaudeMd(dir);
    expect(appendClaudeMd(dir)).toBe("already-present");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- setup-io`
Expected: FAIL — `Cannot find module '../src/cli/setup-io.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/cli/setup-io.ts`:

```ts
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { teamFilePath, type TeamFile } from "../config.js";

/** Where setup writes, honouring TEAM_RELAY_CONFIG_DIR the same way the server reads it. */
export function resolveSetupDir(cwd: string): string {
  return process.env.TEAM_RELAY_CONFIG_DIR
    ? resolve(cwd, process.env.TEAM_RELAY_CONFIG_DIR)
    : join(cwd, ".team-relay");
}

/**
 * Write both setup files. `.env` holds a bot token, so it is created — and
 * re-tightened, in case it already existed with a looser mode — as 0600.
 */
export function writeTeamFiles(
  configDir: string,
  team: TeamFile,
  token: string,
): { teamPath: string; envPath: string } {
  mkdirSync(configDir, { recursive: true });
  const teamPath = teamFilePath(configDir);
  const envPath = join(configDir, ".env");

  writeFileSync(teamPath, `${JSON.stringify(team, null, 2)}\n`, "utf8");
  writeFileSync(envPath, `DISCORD_BOT_TOKEN=${token}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(envPath, 0o600);
  } catch {
    // Windows and some mounts do not support POSIX modes; the content is still written.
  }
  return { teamPath, envPath };
}

export function mcpEntry(cwd: string, configDir: string): object {
  return {
    mcpServers: {
      "team-relay": {
        command: "npx",
        args: ["-y", "team-relay-mcp"],
        env: { TEAM_RELAY_CONFIG_DIR: relPath(cwd, configDir) || "." },
      },
    },
  };
}

export function appendClaudeMd(cwd: string): "appended" | "already-present" | "snippet-missing" {
  let snippet: string;
  try {
    snippet = readFileSync(new URL("../../docs/claude-md-snippet.md", import.meta.url), "utf8");
  } catch {
    return "snippet-missing";
  }
  const target = join(cwd, "CLAUDE.md");
  const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (existing.includes("team-relay")) return "already-present";
  writeFileSync(target, existing ? `${existing.trimEnd()}\n\n${snippet}` : snippet, "utf8");
  return "appended";
}

export function relPath(from: string, to: string): string {
  const r = relative(from, to);
  return r.startsWith("..") ? to : r.split("\\").join("/");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- setup-io`
Expected: PASS, 8 tests.

- [ ] **Step 5: Rewrite init.ts to use it**

In `src/cli/init.ts`: delete the local `appendClaudeMd` and `rel` functions and the inlined `mkdirSync`/`writeFileSync`/`mcpEntry` block, then:

Replace the imports at the top with:

```ts
import type { REST } from "@discordjs/rest";
import { existsSync } from "node:fs";
import { resolveConfigDir, teamFilePath, type TeamFile } from "../config.js";
import { nameKey } from "../core/types.js";
import { probeAuth, probeChannel, probeGuildTextChannels, restClient } from "./discord-probe.js";
import { Prompt } from "./prompt.js";
import { appendClaudeMd, mcpEntry, relPath, resolveSetupDir, writeTeamFiles } from "./setup-io.js";
```

Replace the config-dir block (currently lines 21-31) with:

```ts
const configDir = resolveSetupDir(cwd);
const teamPath = teamFilePath(configDir);
if (
  existsSync(teamPath) &&
  !(await p.confirm(`${relPath(cwd, teamPath)} exists. Overwrite?`, false))
) {
  console.log("Keeping the existing config.");
  return 0;
}
```

Replace the writing block (currently lines 90-109) with:

```ts
const { teamPath: written, envPath } = writeTeamFiles(configDir, team, token);
console.log(`\nWrote ${relPath(cwd, written)} and ${relPath(cwd, envPath)}.`);

console.log("\nAdd this to your project's .mcp.json:\n");
console.log(JSON.stringify(mcpEntry(cwd, configDir), null, 2));

if (await p.confirm("\nAppend the CLAUDE.md guidance snippet now?")) {
  const result = appendClaudeMd(cwd);
  if (result === "appended") console.log("  Appended to CLAUDE.md.");
  else if (result === "already-present")
    console.log("  CLAUDE.md already mentions team-relay; skipped.");
  else console.log("  (couldn't find the snippet; copy docs/claude-md-snippet.md manually)");
}
```

Note `resolveConfigDir` is now unused in this file — remove it from the import if TypeScript flags it.

- [ ] **Step 6: Verify nothing regressed**

Run: `npm run format && npm test && npm run typecheck && npm run smoke`
Expected: 37 + 8 tests pass, typecheck clean, smoke prints `smoke ok`.

- [ ] **Step 7: Commit**

```bash
git add src/cli/setup-io.ts src/cli/init.ts test/setup-io.test.ts
git commit -m "refactor(cli): extract setup file writing into setup-io

The wizard will need to write exactly the files init writes. Extracting
them now means one implementation rather than two that drift.

Also tightens .env to 0600: it holds a bot token and was created with
whatever the umask allowed."
```

---

### Task 2: List the bot's servers

The wizard picks a server from a menu, so it needs the guilds the token can see.

**Files:**

- Modify: `src/cli/discord-probe.ts`
- Test: `test/discord-probe.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `probeGuilds(rest: REST): Promise<{ ok: boolean; detail: string; guilds: { id: string; name: string }[] }>`

The probes only ever call `rest.get`, so tests pass a stub object cast to `REST` — no network.

- [ ] **Step 1: Write the failing test**

Create `test/discord-probe.test.ts`:

```ts
import type { REST } from "@discordjs/rest";
import { describe, expect, it } from "vitest";
import { probeGuilds, probeGuildTextChannels } from "../src/cli/discord-probe.js";

/** Minimal REST stub: maps a route substring to a response or an error to throw. */
function stub(handler: (route: string) => unknown): REST {
  return {
    get: async (route: string) => {
      const out = handler(route);
      if (out instanceof Error) throw out;
      return out;
    },
  } as unknown as REST;
}

describe("probeGuilds", () => {
  it("returns the guilds the bot is in", async () => {
    const rest = stub(() => [
      { id: "1", name: "team" },
      { id: "2", name: "other" },
    ]);
    const res = await probeGuilds(rest);
    expect(res.ok).toBe(true);
    expect(res.guilds).toEqual([
      { id: "1", name: "team" },
      { id: "2", name: "other" },
    ]);
  });

  it("reports an empty roster as not-ok so the caller can prompt for an invite", async () => {
    const res = await probeGuilds(stub(() => []));
    expect(res.ok).toBe(false);
    expect(res.guilds).toEqual([]);
  });

  it("survives an API failure", async () => {
    const res = await probeGuilds(stub(() => Object.assign(new Error("nope"), { status: 401 })));
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("401");
  });
});

describe("probeGuildTextChannels", () => {
  it("keeps only text channels", async () => {
    const rest = stub((route) =>
      route.includes("/channels")
        ? [
            { id: "10", type: 0, name: "general" },
            { id: "11", type: 2, name: "voice" },
            { id: "12", type: 4, name: "category" },
          ]
        : { name: "team" },
    );
    const res = await probeGuildTextChannels(rest, "1");
    expect(res.isGuild).toBe(true);
    expect(res.name).toBe("team");
    expect(res.channels).toEqual([{ id: "10", name: "general" }]);
  });

  it("reports a non-guild id", async () => {
    const res = await probeGuildTextChannels(
      stub(() => Object.assign(new Error("Unknown Guild"), { status: 404 })),
      "999",
    );
    expect(res.isGuild).toBe(false);
    expect(res.channels).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- discord-probe`
Expected: FAIL — `probeGuilds` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/cli/discord-probe.ts`, directly above the existing `probeGuildTextChannels`:

```ts
/** The guilds this bot has been invited to. Empty is a normal, actionable state. */
export async function probeGuilds(
  rest: REST,
): Promise<{ ok: boolean; detail: string; guilds: { id: string; name: string }[] }> {
  try {
    const guilds = (await rest.get(Routes.userGuilds())) as { id: string; name?: string }[];
    const mapped = guilds.map((g) => ({ id: g.id, name: g.name ?? g.id }));
    return mapped.length > 0
      ? { ok: true, detail: `in ${mapped.length} server(s)`, guilds: mapped }
      : { ok: false, detail: "the bot has not been invited to any server yet", guilds: [] };
  } catch (err) {
    return { ok: false, detail: `cannot list servers (${message(err)})`, guilds: [] };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- discord-probe`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/discord-probe.ts test/discord-probe.test.ts
git commit -m "feat(cli): add probeGuilds

The wizard offers the bot's servers as a menu instead of asking for an id.
Tests stub REST rather than hitting Discord, which also covers the existing
guild/channel probe for the first time."
```

---

### Task 3: The wizard's pure model

Everything decidable without a terminal lives here, so it can be tested without one.

**Files:**

- Create: `src/cli/wizard/steps.ts`
- Test: `test/wizard-steps.test.ts`

**Interfaces:**

- Consumes: `TeamFile` from `../../config.js`, `nameKey` from `../../core/types.js`.
- Produces:
  - `type WizardState = { me: string; token: string; botId: string; botName: string; guildId: string; guildName: string; channelId: string; channelName: string; teammates: { name: string; id: string }[] }`
  - `validateName(raw: string): true | string`
  - `validateSnowflake(raw: string): true | string`
  - `addTeammate(state, name, id): { ok: true; state: WizardState } | { ok: false; reason: string }`
  - `inviteUrl(botId: string): string`
  - `reviewItems(state: WizardState): { id: ReviewKey; label: string; value: string }[]`
  - `type ReviewKey = "me" | "token" | "channel" | "teammates"`
  - `toTeamFile(state: WizardState): TeamFile`

- [ ] **Step 1: Write the failing test**

Create `test/wizard-steps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addTeammate,
  inviteUrl,
  reviewItems,
  toTeamFile,
  validateName,
  validateSnowflake,
  type WizardState,
} from "../src/cli/wizard/steps.js";

const BASE: WizardState = {
  me: "alice",
  token: "tok",
  botId: "1546373827578167447",
  botName: "alice-bot",
  guildId: "1546378169022677092",
  guildName: "team",
  channelId: "1546378169722994720",
  channelName: "general",
  teammates: [{ name: "alice", id: "1546373827578167447" }],
};

describe("validateName", () => {
  it("accepts a normal name", () => {
    expect(validateName("alice")).toBe(true);
  });

  it("rejects empty, spaced, and over-long names with a readable reason", () => {
    expect(typeof validateName("")).toBe("string");
    expect(typeof validateName("two words")).toBe("string");
    expect(typeof validateName("a".repeat(33))).toBe("string");
  });
});

describe("validateSnowflake", () => {
  it("accepts a Discord id", () => {
    expect(validateSnowflake("1546373827578167447")).toBe(true);
  });

  it("rejects short and non-numeric input", () => {
    expect(typeof validateSnowflake("123")).toBe("string");
    expect(typeof validateSnowflake("not-an-id")).toBe("string");
  });
});

describe("addTeammate", () => {
  it("adds a teammate", () => {
    const res = addTeammate(BASE, "bob", "1546381319724859412");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.teammates).toHaveLength(2);
  });

  it("lowercases the name", () => {
    const res = addTeammate(BASE, "BOB", "1546381319724859412");
    if (!res.ok) throw new Error(res.reason);
    expect(res.state.teammates[1]?.name).toBe("bob");
  });

  it("refuses a duplicate name regardless of case", () => {
    const res = addTeammate(BASE, "ALICE", "1546381319724859412");
    expect(res).toEqual({ ok: false, reason: expect.stringContaining("already") });
  });

  it("refuses a duplicate bot id, which would break authorship routing", () => {
    const res = addTeammate(BASE, "bob", BASE.botId);
    expect(res).toEqual({ ok: false, reason: expect.stringContaining("id") });
  });

  it("refuses an invalid name or id", () => {
    expect(addTeammate(BASE, "two words", "1546381319724859412").ok).toBe(false);
    expect(addTeammate(BASE, "bob", "123").ok).toBe(false);
  });

  it("does not mutate the input state", () => {
    addTeammate(BASE, "bob", "1546381319724859412");
    expect(BASE.teammates).toHaveLength(1);
  });
});

describe("inviteUrl", () => {
  it("carries the three permissions the relay needs", () => {
    expect(inviteUrl("123")).toBe(
      "https://discord.com/oauth2/authorize?client_id=123&permissions=68608&scope=bot",
    );
  });
});

describe("reviewItems", () => {
  it("summarises every editable value and never shows the token", () => {
    const items = reviewItems(BASE);
    expect(items.map((i) => i.id)).toEqual(["me", "token", "channel", "teammates"]);
    expect(JSON.stringify(items)).not.toContain("tok");
    expect(items.find((i) => i.id === "channel")?.value).toContain("#general");
  });

  it("says so when nobody else is on the roster", () => {
    expect(reviewItems(BASE).find((i) => i.id === "teammates")?.value).toContain("none");
  });
});

describe("toTeamFile", () => {
  it("produces the config the server reads", () => {
    expect(toTeamFile(BASE)).toEqual({
      me: "alice",
      channelId: "1546378169722994720",
      teammates: [{ name: "alice", id: "1546373827578167447" }],
      decisionsFile: "TEAM-DECISIONS.md",
      transport: "discord",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- wizard-steps`
Expected: FAIL — `Cannot find module '../src/cli/wizard/steps.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/cli/wizard/steps.ts`:

```ts
import type { TeamFile } from "../../config.js";
import { nameKey } from "../../core/types.js";

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const SNOWFLAKE_RE = /^\d{15,25}$/;

/** VIEW_CHANNEL (1024) + SEND_MESSAGES (2048) + READ_MESSAGE_HISTORY (65536). */
const INVITE_PERMISSIONS = 68608;

export interface WizardState {
  me: string;
  token: string;
  botId: string;
  botName: string;
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
  teammates: { name: string; id: string }[];
}

export type ReviewKey = "me" | "token" | "channel" | "teammates";

export function validateName(raw: string): true | string {
  const v = raw.trim();
  if (!v) return "Required.";
  if (!NAME_RE.test(v)) return "Letters, digits, - and _ only; max 32, must start alphanumeric.";
  return true;
}

export function validateSnowflake(raw: string): true | string {
  const v = raw.trim();
  if (!v) return "Required.";
  if (!SNOWFLAKE_RE.test(v)) return "A Discord id is 15-25 digits.";
  return true;
}

export function addTeammate(
  state: WizardState,
  name: string,
  id: string,
): { ok: true; state: WizardState } | { ok: false; reason: string } {
  const nameCheck = validateName(name);
  if (nameCheck !== true) return { ok: false, reason: nameCheck };
  const idCheck = validateSnowflake(id);
  if (idCheck !== true) return { ok: false, reason: idCheck };

  const clean = name.trim().toLowerCase();
  const cleanId = id.trim();
  if (state.teammates.some((t) => nameKey(t.name) === nameKey(clean)))
    return { ok: false, reason: `"${clean}" is already on the roster.` };
  // Two teammates sharing a bot id would make inbound authorship ambiguous.
  if (state.teammates.some((t) => t.id === cleanId))
    return { ok: false, reason: "That bot id is already on the roster." };

  return {
    ok: true,
    state: { ...state, teammates: [...state.teammates, { name: clean, id: cleanId }] },
  };
}

export function inviteUrl(botId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${botId}&permissions=${INVITE_PERMISSIONS}&scope=bot`;
}

export function reviewItems(state: WizardState): { id: ReviewKey; label: string; value: string }[] {
  const others = state.teammates.filter((t) => nameKey(t.name) !== nameKey(state.me));
  return [
    { id: "me", label: "Your name", value: state.me },
    { id: "token", label: "Bot", value: `${state.botName} (${state.botId})` },
    {
      id: "channel",
      label: "Channel",
      value: `#${state.channelName} in ${state.guildName}`,
    },
    {
      id: "teammates",
      label: "Teammates",
      value: others.length > 0 ? others.map((t) => t.name).join(", ") : "none yet",
    },
  ];
}

export function toTeamFile(state: WizardState): TeamFile {
  return {
    me: state.me,
    channelId: state.channelId,
    teammates: state.teammates,
    decisionsFile: "TEAM-DECISIONS.md",
    transport: "discord",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- wizard-steps`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/wizard/steps.ts test/wizard-steps.test.ts
git commit -m "feat(cli): add the wizard's pure model

Validation, roster merging, the invite URL and the review summary, with no
terminal or network in the module, so all of it is unit-tested. The review
summary deliberately omits the token."
```

---

### Task 4: The wizard shell

**Files:**

- Create: `src/cli/wizard/run.ts`
- Modify: `package.json` (add `@inquirer/prompts`)

**Interfaces:**

- Consumes: everything Task 3 produces; `probeAuth`, `probeGuilds`, `probeGuildTextChannels`, `probeReadHistory`, `restClient` from `../discord-probe.js`; `appendClaudeMd`, `mcpEntry`, `relPath`, `resolveSetupDir`, `writeTeamFiles` from `../setup-io.js`.
- Produces: `runWizard(cwd?: string): Promise<number>`

- [ ] **Step 1: Add the dependency**

```bash
npm install @inquirer/prompts
```

Confirm it landed in `dependencies`, not `devDependencies`:

```bash
node -e 'console.log(require("./package.json").dependencies["@inquirer/prompts"])'
```

- [ ] **Step 2: Write the implementation**

Create `src/cli/wizard/run.ts`:

```ts
import { confirm, input, password, select } from "@inquirer/prompts";
import type { REST } from "@discordjs/rest";
import { existsSync } from "node:fs";
import { teamFilePath } from "../../config.js";
import {
  probeAuth,
  probeGuilds,
  probeGuildTextChannels,
  probeReadHistory,
  restClient,
} from "../discord-probe.js";
import { appendClaudeMd, mcpEntry, relPath, resolveSetupDir, writeTeamFiles } from "../setup-io.js";
import {
  addTeammate,
  inviteUrl,
  reviewItems,
  toTeamFile,
  validateName,
  validateSnowflake,
  type ReviewKey,
  type WizardState,
} from "./steps.js";

const BACK = "\u0000back";

export async function runWizard(cwd = process.cwd()): Promise<number> {
  const configDir = resolveSetupDir(cwd);
  const teamPath = teamFilePath(configDir);

  console.log("team-relay-mcp setup\n");
  if (existsSync(teamPath)) {
    const overwrite = await confirm({
      message: `${relPath(cwd, teamPath)} already exists. Overwrite it?`,
      default: false,
    });
    if (!overwrite) {
      console.log("Keeping the existing config.");
      return 0;
    }
  }

  const state = {
    me: "",
    token: "",
    botId: "",
    botName: "",
    guildId: "",
    guildName: "",
    channelId: "",
    channelName: "",
    teammates: [],
  } as WizardState;

  let s = state;
  s = await askName(s);
  s = await askToken(s);
  s = await askChannel(s);
  s = await askRoster(s);

  // Review loop: fix anything before writing.
  for (;;) {
    console.log("");
    for (const item of reviewItems(s)) console.log(`  ${item.label.padEnd(10)} ${item.value}`);
    const choice = await select<ReviewKey | "save">({
      message: "Save this?",
      choices: [
        { name: "Save and finish", value: "save" as const },
        ...reviewItems(s).map((i) => ({ name: `Change ${i.label.toLowerCase()}`, value: i.id })),
      ],
    });
    if (choice === "save") break;
    if (choice === "me") s = await askName(s);
    if (choice === "token") s = await askToken(s);
    if (choice === "channel") s = await askChannel(s);
    if (choice === "teammates") s = await askRoster({ ...s, teammates: selfOnly(s) });
  }

  const { teamPath: written, envPath } = writeTeamFiles(configDir, toTeamFile(s), s.token);
  console.log(`\nWrote ${relPath(cwd, written)} and ${relPath(cwd, envPath)}.`);

  console.log("\nAdd this to your project's .mcp.json:\n");
  console.log(JSON.stringify(mcpEntry(cwd, configDir), null, 2));

  if (await confirm({ message: "Append the CLAUDE.md guidance snippet?", default: true })) {
    const result = appendClaudeMd(cwd);
    if (result === "appended") console.log("  Appended to CLAUDE.md.");
    else if (result === "already-present")
      console.log("  CLAUDE.md already mentions team-relay; skipped.");
    else console.log("  (couldn't find the snippet; copy docs/claude-md-snippet.md manually)");
  }

  console.log("\nNext: run `team-relay-mcp doctor`, then restart Claude Code.");
  return 0;
}

function selfOnly(s: WizardState): { name: string; id: string }[] {
  return s.teammates.filter((t) => t.name === s.me);
}

async function askName(s: WizardState): Promise<WizardState> {
  const me = await input({
    message: "Your name (teammates will address you by it)",
    default: s.me || undefined,
    validate: validateName,
  });
  const lower = me.trim().toLowerCase();
  // Keep the self entry's name in step with the answer.
  return {
    ...s,
    me: lower,
    teammates: s.teammates.map((t) => (t.name === s.me ? { ...t, name: lower } : t)),
  };
}

/** Ask for a token, authenticate it, and make sure the bot is actually in a server. */
async function askToken(s: WizardState): Promise<WizardState> {
  for (;;) {
    const token = await password({ message: "Your Discord bot token", mask: "*" });
    if (!token.trim()) continue;

    const rest = restClient(token.trim());
    const auth = await probeAuth(rest);
    if (!auth.ok || !auth.userId) {
      console.log(`  ${auth.detail}`);
      continue;
    }
    console.log(`  ${auth.detail}`);

    const next: WizardState = {
      ...s,
      token: token.trim(),
      botId: auth.userId,
      botName: auth.username ?? auth.userId,
    };
    await ensureInvited(rest, next);
    return withSelf(next);
  }
}

/** A bot in no server cannot be set up. Hand over a ready-made invite URL and wait. */
async function ensureInvited(rest: REST, s: WizardState): Promise<void> {
  for (;;) {
    const guilds = await probeGuilds(rest);
    if (guilds.ok) return;
    console.log(`\n  This bot is not in any server yet. Invite it:\n`);
    console.log(`    ${inviteUrl(s.botId)}\n`);
    await confirm({ message: "  Done? (checks again)", default: true });
  }
}

function withSelf(s: WizardState): WizardState {
  const others = s.teammates.filter((t) => t.name !== s.me);
  return { ...s, teammates: [{ name: s.me, id: s.botId }, ...others] };
}

/** Pick the server, then the channel. Nothing is transcribed. */
async function askChannel(s: WizardState): Promise<WizardState> {
  const rest = restClient(s.token);
  for (;;) {
    const guilds = await probeGuilds(rest);
    if (!guilds.ok) {
      await ensureInvited(rest, s);
      continue;
    }

    const guildId =
      guilds.guilds.length === 1
        ? guilds.guilds[0]!.id
        : await select({
            message: "Which server is the team in?",
            choices: guilds.guilds.map((g) => ({ name: g.name, value: g.id })),
          });
    const guild = guilds.guilds.find((g) => g.id === guildId)!;
    if (guilds.guilds.length === 1) console.log(`  Server: ${guild.name}`);

    const detail = await probeGuildTextChannels(rest, guildId);
    if (detail.channels.length === 0) {
      console.log(
        `  No text channels are visible in ${guild.name}. The bot needs the ` +
          `"View Channels" permission — re-invite it with:\n\n    ${inviteUrl(s.botId)}\n`,
      );
      await confirm({ message: "  Done? (checks again)", default: true });
      continue;
    }

    const choices: { name: string; value: string }[] = detail.channels.map((c) => ({
      name: `#${c.name}`,
      value: c.id,
    }));
    if (guilds.guilds.length > 1) choices.push({ name: "← back to servers", value: BACK });

    const channelId = await select({ message: "Which channel?", choices });
    if (channelId === BACK) continue;

    const history = await probeReadHistory(rest, channelId);
    if (!history.ok) {
      console.log(`  ${history.detail}`);
      continue;
    }

    const channel = detail.channels.find((c) => c.id === channelId)!;
    return {
      ...s,
      guildId,
      guildName: guild.name,
      channelId,
      channelName: channel.name,
    };
  }
}

async function askRoster(s: WizardState): Promise<WizardState> {
  console.log(`\n  Your bot's user id is ${s.botId}`);
  console.log("  Share it with your teammates, and collect theirs.\n");

  let next = s;
  for (;;) {
    const more = await confirm({
      message: `Add a teammate? (${next.teammates.length - 1} added)`,
      default: next.teammates.length === 1,
    });
    if (!more) return next;

    const name = await input({ message: "  Teammate name", validate: validateName });
    const id = await input({
      message: `  ${name.trim()}'s bot user id`,
      validate: validateSnowflake,
    });
    const result = addTeammate(next, name, id);
    if (!result.ok) {
      console.log(`  ${result.reason}`);
      continue;
    }
    next = result.state;
  }
}
```

- [ ] **Step 3: Verify it compiles and is formatted**

Run: `npm run format && npm run typecheck && npm run build`
Expected: all clean, `dist/cli/wizard/run.js` exists.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/cli/wizard/run.ts
git commit -m "feat(cli): add the setup wizard shell

Drives the pure model with @inquirer/prompts: the token is masked, the
invite URL is generated from the bot's own id, and the server and channel
are chosen from menus rather than transcribed. A review screen at the end
lets any answer be redone before anything is written."
```

---

### Task 5: Route init to the wizard

**Files:**

- Create: `src/cli/init-plain.ts` (today's flow, moved)
- Modify: `src/cli/init.ts` (becomes the dispatcher)
- Test: `test/init-dispatch.test.ts`

**Interfaces:**

- Consumes: `runWizard` from `./wizard/run.js`.
- Produces: `runInit(cwd?: string): Promise<number>` (unchanged signature), `chooseMode(isTty: boolean): "wizard" | "plain"`

- [ ] **Step 1: Write the failing test**

Create `test/init-dispatch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chooseMode } from "../src/cli/init.js";

describe("chooseMode", () => {
  it("uses the wizard on a terminal", () => {
    expect(chooseMode(true)).toBe("wizard");
  });

  it("falls back to plain prompts when stdin is not a TTY", () => {
    expect(chooseMode(false)).toBe("plain");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- init-dispatch`
Expected: FAIL — `chooseMode` is not exported.

- [ ] **Step 3: Move the current flow**

`git mv src/cli/init.ts src/cli/init-plain.ts`, then in `src/cli/init-plain.ts` rename the exported function:

```ts
export async function runPlainInit(cwd = process.cwd()): Promise<number> {
```

(the rest of the file is unchanged from Task 1)

- [ ] **Step 4: Write the dispatcher**

Create `src/cli/init.ts`:

```ts
import { stdin } from "node:process";

export function chooseMode(isTty: boolean): "wizard" | "plain" {
  return isTty ? "wizard" : "plain";
}

export async function runInit(cwd = process.cwd()): Promise<number> {
  if (chooseMode(Boolean(stdin.isTTY)) === "plain") {
    const { runPlainInit } = await import("./init-plain.js");
    return runPlainInit(cwd);
  }

  const { runWizard } = await import("./wizard/run.js");
  try {
    return await runWizard(cwd);
  } catch (err) {
    // Ctrl+C inside a prompt throws rather than exiting; that is a normal quit.
    if ((err as { name?: string }).name === "ExitPromptError") {
      console.log("\nCancelled. Nothing was written.");
      return 130;
    }
    throw err;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- init-dispatch`
Expected: PASS, 2 tests.

- [ ] **Step 6: Verify both paths still work end to end**

```bash
npm run format && npm test && npm run typecheck && npm run build
echo "" | node dist/cli/main.js init   # non-TTY: must use the plain flow, not crash
```

Expected: full suite passes; the piped run reaches the plain prompts and exits without a stack trace.

- [ ] **Step 7: Commit**

```bash
git add src/cli/init.ts src/cli/init-plain.ts test/init-dispatch.test.ts
git commit -m "feat(cli): run the wizard when init has a terminal

Keeps one documented command. Pipes and CI still get the linear prompts,
so existing scripts are unaffected, and Ctrl+C out of a prompt exits 130
without writing anything."
```

---

### Task 6: Documentation and live regression

**Files:**

- Modify: `README.md` (section "2. Run setup")

- [ ] **Step 1: Update the README**

Replace the body of "### 2. Run setup" (keeping the heading and the `npx -y team-relay-mcp init` block) with:

```markdown
From your project directory:

    npx -y team-relay-mcp init

On a terminal this runs a setup wizard. It asks for your name and bot token,
then — because the token identifies your bot — it generates the invite URL for
you and lets you **pick the server and channel from a list**, so you never have
to copy a channel id. A review screen at the end lets you fix any answer before
anything is written.

If the bot has not been invited yet, the wizard prints a ready-made invite URL
with the right permissions and waits.

Piped or non-interactive runs fall back to plain prompts, which ask for the
channel id directly.

The wizard writes `.team-relay/team.json` and `.team-relay/.env` (mode `0600`,
since it holds your token) and prints the `.mcp.json` entry. You can edit
`team.json` by hand later to finish the roster:
```

Leave the existing JSON example and everything after it in place.

- [ ] **Step 2: Verify the docs build clean**

Run: `npm run format && npm run format:check`
Expected: `All matched files use Prettier code style!`

- [ ] **Step 3: Run the live two-bot regression**

The wizard writes the same config shape the relay reads; prove it against real Discord rather than trusting the unit tests.

```bash
npm run build
env -u DISCORD_BOT_TOKEN -u TEAM_RELAY_CONFIG_DIR node .team-relay/testrig/e2e.mjs
env -u DISCORD_BOT_TOKEN node dist/cli/main.js doctor
```

Expected: `12 passed, 0 failed` and `All checks passed.`

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: describe the setup wizard

Says what the wizard does differently — invite URL generated, server and
channel picked from menus, answers editable at the end — and records that
non-interactive runs still get the old prompts."
```

---

## Verification

After Task 6, the whole branch should satisfy:

```bash
npm test            # 37 existing + 29 new
npm run typecheck
npm run format:check
npm run smoke       # 6 PASS
node dist/cli/main.js init   # wizard appears on a terminal
```
