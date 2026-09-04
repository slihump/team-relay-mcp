# Roadmap

v1 is deliberately small: async teammate ↔ teammate Q&A, a shared decision log,
verified authorship, Discord transport, and an in-memory transport for tests.

Everything below is **not** in v1.

## Real-time delivery (custom Channel adapter)

Ship an optional adapter that implements the [Claude Code channel contract](https://code.claude.com/docs/en/channels-reference)
so messages push into a running session instead of waiting for `team_sync`.
Blocked on the research-preview friction: custom channels aren't on the approved
allowlist, so users would need `--dangerously-load-development-channels` (or a
Team/Enterprise admin adding it to `allowedChannelPlugins`). Worth doing once
that eases.

## Presence / activity

An opt-in heartbeat: "alice's session is active, touching `src/auth/`". A
`team_status` view so Claude can avoid colliding with a teammate mid-refactor,
and `ask_teammate` can warn when the recipient looks offline.

## Diff / file attachment

Let `ask_teammate` attach a `git diff` or a file range so the other session
answers with real context. Needs an explicit opt-in per send and a
secret-redaction pass before anything leaves the machine.

## More transports

- **File / git transport** — a shared folder or a committed `.team-relay/log`
  for teams that would rather not run a Discord bot.
- **Slack transport** — same contract, Slack API.

## Question ergonomics

- `wait_for_reply(conversation_id, timeout)` — block the current step until an
  answer arrives, for the "ask, then continue" flow.
- Nudges for questions that sit unanswered past a threshold.

## Routing

Optional Discord-thread-per-conversation so humans reading the channel can follow
along, and `[TO:]` collisions become impossible.
