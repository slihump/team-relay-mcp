# Setup wizard for `team-relay-mcp init`

Status: approved 2026-09-07

## Problem

Setting up team-relay takes a teammate through six steps, and four of them ask
for something the terminal cannot help them find. A real setup run on 2026-09-07
stalled twice:

- **The OAuth2 invite.** The README told the user to tick a permission called
  "View Channel". The checkbox in Discord's URL Generator reads "View
  **Channels**", so they looked for a control that does not exist and stopped.
- **The channel id.** They pasted the _server_ id. Both ids are snowflakes, the
  two "Copy ID" menu items sit one context menu apart, and `team.json` types
  `channelId` as a bare string, so setup accepted it. Discord answers `404
Unknown Channel` both when the bot is not in the server and when the id is not
  a channel, so `doctor` could not say which was wrong. Diagnosing it needed
  three manual API calls.

Both failures share a shape: `init` asks a human to transcribe an opaque
identifier that the bot's own token could have looked up.

## Goals

1. Never ask for an id that can be discovered from the token.
2. Let a typo be fixed without restarting setup.
3. Keep `init` working in non-interactive contexts (pipes, CI).
4. Do not regress the setup path that already works.

## Non-goals

- No browser UI and no local HTTP server. Considered and rejected: it adds a
  server and a port to a project whose entire premise is that there is no
  server, and the audience already lives in a terminal.
- No automatic teammate-roster exchange over the Discord channel. It needs a new
  protocol message and a trust story; roster entries stay manual for now.
- No reimplementation of `doctor` inside the wizard. The wizard ends by telling
  the user to run it.

## Decisions

| Decision      | Choice                     | Why                                                                                                                                                               |
| ------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface     | Terminal UI, not a browser | Audience is already in a terminal; keeps the "no server" premise                                                                                                  |
| Scope         | Full wizard                | The pain is spread across steps, not concentrated in one                                                                                                          |
| Input library | `@inquirer/prompts`        | Terminal edge cases (Windows ConHost, narrow windows, non-TTY, Ctrl+C) are where hand-rolled TUIs break, and this project has already run on two Windows machines |
| Command       | Replace `init`             | One documented command; scripts keep working via the non-TTY fallback                                                                                             |

## Flow

```
(0) Overwrite?    only when team.json already exists; declining exits unchanged
(1) Name          text, validated against NAME_RE
(2) Token         masked input -> probeAuth, shows bot username + id
(3) Invite        if the bot is in no guild: print the invite URL built from the
                  bot's own id with permissions=68608, confirm, re-poll
(4) Server        select from the guilds the bot is in; auto-select when there is one
(5) Channel       select from that guild's text channels, then verify read access
(6) Roster        show my bot user id to share; add teammates until done
(7) CLAUDE.md     confirm appending the guidance snippet
(8) Review        show every value; save, or pick one item to redo
```

Step 3 is what removes the first failure above: with the token in hand the bot's
application id is known, so the invite URL can be generated complete with the
right permission bits. Steps 4 and 5 remove the second: the ids are chosen from
lists, never transcribed.

`permissions=68608` is `VIEW_CHANNEL` (1024) + `SEND_MESSAGES` (2048) +
`READ_MESSAGE_HISTORY` (65536).

### Going back

Back-navigation lives in step 8, not in every step. `@inquirer/prompts` has no
back concept for text inputs, and threading one through each prompt is the kind
of thing that breaks on the terminals we cannot test. Instead the review screen
lists every collected value and lets the user pick one to redo; that step reruns
and returns to the review. List-shaped steps (4 and 5) additionally offer a
`← back` choice, where it costs nothing.

This satisfies goal 2 without inventing a prompt framework.

## Structure

Wizard logic is separated from terminal I/O so the logic can be tested without a
TTY.

| File                       | Responsibility                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli/wizard/steps.ts`  | **Pure.** Validation, the review-screen model, which step to run next, roster merging. No imports from inquirer or the network. |
| `src/cli/wizard/run.ts`    | Imperative shell: inquirer prompts and Discord probes wired to the pure model.                                                  |
| `src/cli/setup-io.ts`      | Writes `team.json` and `.env`, prints the `.mcp.json` entry, appends the CLAUDE.md snippet.                                     |
| `src/cli/init.ts`          | Thin dispatcher: TTY -> wizard, otherwise the plain flow.                                                                       |
| `src/cli/init-plain.ts`    | Today's linear prompt flow, moved with minimal edits.                                                                           |
| `src/cli/discord-probe.ts` | Gains `probeGuilds()`; `probeAuth`, `probeChannel`, `probeGuildTextChannels` and `probeReadHistory` are reused as-is.           |

Extracting `setup-io.ts` is the point of the split: without it the wizard and the
fallback would each write `team.json` and drift apart.

`.env` is written with mode `0600`. It holds a bot token and is currently created
with the default umask.

## Testing

- **`wizard/steps.ts` unit tests** (vitest, no network, no TTY): name and
  snowflake validation, roster de-duplication and self-entry handling, review
  model transitions, detection of incomplete steps.
- **`setup-io.ts` unit tests**: write into a temp dir; assert `team.json`
  contents, the `.env` line, and the `0600` mode.
- The inquirer shell is not unit-tested. Terminal-driving tests cost more than
  they find here; it is covered by `npm run smoke` and by running the wizard.
- **Live regression**: after the wizard lands, re-run
  `.team-relay/testrig/e2e.mjs` so a config produced by the wizard is proven to
  drive a real two-bot relay, not just to look right on disk.

## Risks

- **New runtime dependency.** `@inquirer/prompts` is the first dependency that
  serves only setup, so it is installed by everyone who runs the server.
  Accepted deliberately in exchange for terminal handling we would otherwise own.
- **Step 3 needs the user to leave the terminal.** Inviting a bot is a browser
  action; the wizard can only hand over the URL and poll. The loop must not spin:
  it re-checks on confirmation, not on a timer.
- **Guild and channel listing needs permissions.** A bot invited without `View
Channels` lists no channels. When step 5 finds an empty list, it must say that
  the permission is missing rather than show an empty menu.
