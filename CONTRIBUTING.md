# Contributing

## Setup

```bash
npm install
npm test
```

Node 20+ is required.

## Layout

```
src/
  core/         domain logic, no I/O — types, protocol (wire format), conversation
                folding, digest computation, decision-file rendering
  transport/    the TeamTransport interface + implementations (discord, memory)
  state/        local JSON state (cursor + what this machine has acted on)
  cli/          init / doctor wizards
  relay.ts      orchestrates transport + state + core
  server.ts     MCP tool definitions
  index.ts      stdio entrypoint
```

The rule: nothing above `transport/` knows what Discord is. A new transport is a
new file implementing `TeamTransport` and passing `test/transport.test.ts`.

## Tests

- `npm test` — unit + integration on the in-memory transport. No network.
- `npm run smoke` — builds, then drives the real MCP server over stdio.
- Keep the "no-drop" invariants covered: a question resurfaces until replied, an
  answer until acked, and everything self-heals from channel history.

## Before a PR

```bash
npm run format
npm run typecheck
npm test
```

## Scope

v1 is intentionally minimal (see [ROADMAP.md](ROADMAP.md)). New features should
land behind config, keep the async-first / no-drop guarantees, and not pull a
gateway/websocket dependency into the Discord transport.
