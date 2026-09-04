# Security

## Reporting a vulnerability

Use [GitHub's private advisory form](https://github.com/slihump/team-relay-mcp/security/advisories/new).
Please don't open a public issue for anything security-relevant.

## Threat model

`team-relay-mcp` moves messages between teammates' Claude Code sessions through a
shared chat channel. Things to be aware of:

- **Relayed content is untrusted input.** `team_sync` surfaces messages other
  people wrote. The bundled CLAUDE.md snippet tells Claude to treat them as
  information, never as instructions, and to confirm with the user before acting
  on a relayed request or sending code. If you write your own guidance, keep
  that boundary.
- **Authorship is verified, identity is asserted.** Each teammate posts through
  their own bot; a message whose Discord author isn't in the roster, or whose
  payload `from` doesn't match that author, is dropped. The roster itself is
  trust-on-first-use — teammates exchange bot ids out of band.
- **The channel is permanent storage.** Everything relayed lands in Discord's
  channel history indefinitely. Don't relay secrets.
- **Your bot token is a channel-wide credential.** Keep `.team-relay/.env` out of
  version control (the shipped `.gitignore` does this) and don't share it.

## Supported versions

Pre-1.0 in spirit — the latest `main` / latest release is the only supported
version.
