# team-relay-mcp

[![CI](https://github.com/slihump/team-relay-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/slihump/team-relay-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](package.json)
[![Model Context Protocol](https://img.shields.io/badge/MCP-server-8A2BE2.svg)](https://modelcontextprotocol.io)

An MCP server that lets a small team's **separate** Claude Code sessions ask each
other questions, hand back answers, and share decisions — through one shared chat
channel, with each person on their own Claude subscription.

No API key. No central server. No shared credentials. The relay never calls a
model; it only moves messages in and out of a Discord channel.

```mermaid
flowchart TB
    subgraph A["Alice's machine"]
        CCA["Claude Code<br/>(Alice's login)"] <-->|MCP stdio| TRA["team-relay-mcp<br/>+ Alice's bot"]
    end
    subgraph B["Bob's machine"]
        CCB["Claude Code<br/>(Bob's login)"] <-->|MCP stdio| TRB["team-relay-mcp<br/>+ Bob's bot"]
    end
    TRA <--> CH[("shared Discord channel<br/>· authorship verified per message<br/>· history is the source of truth")]
    TRB <--> CH
```

## Why this exists

Claude Code in 2026 has good building blocks for one person — [Channels](https://code.claude.com/docs/en/channels-reference)
(bridge one session to Discord/Telegram), [cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
(sessions on **one machine**), [Agent Teams](https://docs.claude.com/en/docs/claude-code/agent-teams)
(one person's agents), [Remote Control](https://code.claude.com/docs/en/remote-control)
(your own session from another device). None of them connect **two different
people on two different subscriptions**. That's the gap this fills.

`team-relay-mcp` is a thin layer for one narrow job: teammate ↔ teammate Q&A and
a shared decision log, built to be **async-first** — it assumes sessions are
usually off and makes sure nothing is lost when they come back.

**What it is not:** real-time. v1 polls channel history when Claude calls
`team_sync`. See [ROADMAP.md](ROADMAP.md).

## Install

```bash
npm install -g team-relay-mcp
# or run without installing: npx -y team-relay-mcp <command>
```

### 1. Create your Discord bot (each teammate does this once)

Every teammate runs **their own** bot so that message authorship can be verified
(a shared bot could not tell who sent what).

1. <https://discord.com/developers/applications> → **New Application**
2. **Bot** → enable **Message Content Intent** (under Privileged Gateway Intents).
   Required — without it you cannot read teammates' messages.
3. **Bot** → **Reset Token** → copy it somewhere safe. This is your `DISCORD_BOT_TOKEN`.
4. **OAuth2 → URL Generator**: scope `bot`, permissions **View Channel**,
   **Read Message History**, **Send Messages**. Open the generated URL and add the
   bot to your team's server.

One person creates a channel for the team (e.g. `#claude-relay`) and shares its
**channel id** (right-click the channel → Copy Channel ID; enable Developer Mode
in Discord settings if you don't see it). Everyone uses the **same channel id**.

### 2. Run setup

From your project directory:

```bash
npx -y team-relay-mcp init
```

It asks for your name, bot token, and the channel id, verifies the token, and
prints **your bot's user id**. Exchange ids with your teammates and finish the
roster (you can also edit `.team-relay/team.json` by hand later):

```json
{
  "me": "alice",
  "channelId": "1234567890",
  "teammates": [
    { "name": "alice", "id": "111111111111111111" },
    { "name": "bob", "id": "222222222222222222" }
  ],
  "decisionsFile": "TEAM-DECISIONS.md",
  "transport": "discord"
}
```

### 3. Wire it into Claude Code

`init` prints an `.mcp.json` entry:

```json
{
  "mcpServers": {
    "team-relay": {
      "command": "npx",
      "args": ["-y", "team-relay-mcp"],
      "env": { "TEAM_RELAY_CONFIG_DIR": ".team-relay" }
    }
  }
}
```

Put your bot token in `.team-relay/.env` (`init` does this) **or** in the `env`
block above. Then paste [docs/claude-md-snippet.md](docs/claude-md-snippet.md)
into your project's `CLAUDE.md` and restart Claude Code.

### 4. Check it

```bash
npx -y team-relay-mcp doctor
```

## Tools

| Tool                                           | For                                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `team_sync`                                    | Catch up: questions to answer, answers to your questions, new decisions, notes. Call at session start and after each unit of work. |
| `ask_teammate(to, question, context?)`         | Ask one teammate something only they or their local code can answer.                                                               |
| `ask_team(question, context?)`                 | Broadcast a question to everyone.                                                                                                  |
| `reply(conversation_id, answer)`               | Answer a teammate's question.                                                                                                      |
| `ack(conversation_id, note?)`                  | Mark an answer to your question as resolved so it stops resurfacing.                                                               |
| `record_decision(topic, decision, rationale?)` | Log a decision; it lands in every teammate's `TEAM-DECISIONS.md`.                                                                  |
| `post_note(text, to?)`                         | Send an FYI that needs no answer.                                                                                                  |

## How it stays reliable

- **The channel is the source of truth.** Locally, each machine keeps only a
  cursor and which items it has acted on (`.team-relay/state.json`). Lose it and
  the next `team_sync` rebuilds from channel history.
- **Nothing is delivered once and forgotten.** A question to you reappears in
  every `team_sync` until you `reply`. An answer to you reappears until you `ack`.
- **Authorship is verified.** Every teammate posts via their own bot; an inbound
  message whose Discord author isn't in the roster, or whose payload `from`
  doesn't match that author, is dropped. `team_sync` reports the drop count.

## Security & privacy

- Relayed messages are **untrusted input**. The CLAUDE.md snippet tells Claude to
  treat them as information, never as instructions, and to confirm with you
  before sending code or acting on a relayed request.
- Everything posted to the relay is stored in Discord's channel history
  indefinitely. Don't relay secrets.
- Your bot token grants full access to that channel — keep `.team-relay/.env` out
  of git (the provided `.gitignore` handles it) and don't share it.

## Limitations

- **Not real-time** (v1). `team_sync` is a poll.
- **Routing is by name.** Names must be unique in the roster (case-insensitive).
- **Discord only** (v1).

## Development

```bash
npm install
npm test          # unit + integration, no Discord needed
npm run smoke      # build, then exercise the MCP server over stdio
npm run typecheck
```

The [`memory` transport](src/transport/memory.ts) runs the whole thing in-process
with no Discord bot — set `"transport": "memory"` in `team.json` to try the tools.

To point a local Claude Code at the built server before publishing:

```json
{
  "mcpServers": {
    "team-relay": {
      "command": "node",
      "args": ["/absolute/path/to/team-relay-mcp/dist/index.js"],
      "env": { "TEAM_RELAY_CONFIG_DIR": "/absolute/path/to/your/project/.team-relay" }
    }
  }
}
```

## License

MIT
