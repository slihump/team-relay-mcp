# npm and Docker Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a verified npm package and GHCR container from matching semantic-version tags, with local and CI checks for both artifacts.

**Architecture:** Keep the existing stdio server unchanged. Add artifact-level smoke scripts, a multi-stage non-root container, CI build gates, and an OIDC npm/GHCR release workflow around the current CLI. The project version in `package.json` remains the single release version.

**Tech Stack:** Node.js 24, npm 11, Docker BuildKit/Buildx, GitHub Actions, GHCR, npm Trusted Publishing (OIDC)

**Spec:** `docs/superpowers/specs/2026-09-14-npm-docker-release-design.md`

## Global Constraints

- Release tags use `vMAJOR.MINOR.PATCH` and must match `package.json#version` after removing `v`.
- npm publishes `team-relay-mcp` publicly with provenance.
- The container publishes as `ghcr.io/slihump/team-relay-mcp` for `linux/amd64` and `linux/arm64`.
- The runtime container uses Node 24 Alpine, runs as a non-root user by default, and preserves the existing stdio protocol.
- Runtime configuration, state, and decisions remain project-local through a read/write `/workspace` mount.
- The image never contains `.env`, `.team-relay`, Discord tokens, state, or conversation logs.
- Existing MCP tools, Discord protocol, and stored-state formats do not change.
- Existing user changes to `.gitignore` must remain untouched and uncommitted.

---

### Task 1: Verify the npm artifact as a real consumer

**Files:**
- Create: `scripts/package-smoke.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `npm run build` output and `package.json#files`/`bin`
- Produces: `npm run package:check`, which validates contents, installs the tarball in a temporary project, and executes its CLI

- [ ] **Step 1: Add the command before its implementation**

Add this script to `package.json`:

```json
"package:check": "node scripts/package-smoke.mjs"
```

- [ ] **Step 2: Run it and verify the missing implementation fails**

Run: `npm run package:check`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/package-smoke.mjs`.

- [ ] **Step 3: Implement the artifact smoke script**

Create `scripts/package-smoke.mjs` that:

```javascript
const required = new Set([
  "LICENSE",
  "README.md",
  "dist/cli/main.js",
  "dist/index.js",
  "docs/claude-md-snippet.md",
  "package.json",
]);
const forbiddenPrefixes = [".env", ".team-relay/", "conversation-logs/", "src/", "test/"];
```

It must run `npm pack --dry-run --json --ignore-scripts`, reject missing required
files and forbidden paths, create a tarball in a temporary directory, install it
into a clean temporary consumer project with `npm install --ignore-scripts`, run
`node_modules/.bin/team-relay-mcp --help`, assert that the help contains the
project description, and always remove the temporary directory.

- [ ] **Step 4: Build and verify the npm artifact**

Run: `npm run build && npm run package:check`

Expected: PASS with the packed file count and packaged CLI confirmation.

- [ ] **Step 5: Commit the npm artifact check**

```bash
git add package.json scripts/package-smoke.mjs
git commit -m "build: verify the published npm package"
```

### Task 2: Build a minimal non-root Docker image

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: `package-lock.json`, TypeScript source, and the existing CLI entry point
- Produces: `team-relay-mcp:test`, with entry point `node /app/dist/cli/main.js`, working directory `/workspace`, and default argument `serve`

- [ ] **Step 1: Add Docker commands before the Dockerfile exists**

Add these scripts to `package.json`:

```json
"docker:build": "docker build --tag team-relay-mcp:test .",
"docker:smoke": "node scripts/docker-smoke.mjs team-relay-mcp:test"
```

- [ ] **Step 2: Verify the Docker build fails for the missing file**

Run: `npm run docker:build`

Expected: FAIL because the repository has no `Dockerfile`.

- [ ] **Step 3: Add the container build**

Create a multi-stage `Dockerfile` with this runtime contract:

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/
COPY --from=build --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/dist /app/dist
COPY --chown=node:node README.md LICENSE /app/
USER node
ENTRYPOINT ["node", "/app/dist/cli/main.js"]
CMD ["serve"]
```

Create `.dockerignore` entries for `.git`, `.github`, `node_modules`, `dist`,
coverage, `.env*`, `.team-relay`, `TEAM-DECISIONS.md`, `conversation-logs`, editor
files, and local prototype/build artifacts.

- [ ] **Step 4: Build and inspect the runtime image**

Run: `npm run docker:build`

Run: `docker image inspect team-relay-mcp:test --format '{{json .Config}}'`

Expected: build succeeds; image config reports `/workspace`, non-root `node`, the
CLI entry point, and `serve` as its command.

- [ ] **Step 5: Commit the Docker image**

```bash
git add Dockerfile .dockerignore package.json
git commit -m "build: add a production Docker image"
```

### Task 3: Exercise MCP over the container's stdio

**Files:**
- Create: `scripts/docker-smoke.mjs`
- Modify: `scripts/smoke.mjs`

**Interfaces:**
- Consumes: the Docker image name passed as `process.argv[2]`
- Produces: `npm run docker:smoke`, which runs the packaged CLI help and the existing MCP handshake/tool checks through `docker run -i`

- [ ] **Step 1: Run the new Docker smoke command before its implementation**

Run: `npm run docker:smoke`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/docker-smoke.mjs`.

- [ ] **Step 2: Extract the protocol checks into a reusable runner**

Refactor `scripts/smoke.mjs` to export an async `runSmoke({ command, args, cwd,
env })` helper while retaining its current direct local behavior. The helper
creates the memory-transport fixture, drives `initialize`, `tools/list`,
`team_sync`, `ask_teammate`, its error case, and `record_decision`, then cleans up.

- [ ] **Step 3: Implement the container adapter**

Create `scripts/docker-smoke.mjs` that first runs `<image> --help`, then calls the
shared runner with:

```javascript
{
  command: "docker",
  args: [
    "run", "--rm", "-i",
    "--user", `${process.getuid()}:${process.getgid()}`,
    "--mount", `type=bind,source=${fixtureDir},target=/workspace`,
    image,
  ],
}
```

Pass host UID/GID only when available, quote no shell fragments, and rely on
`spawn` argument arrays. The shared runner supplies the fixture directory to the
adapter so the mounted `.team-relay/team.json` exists before the container starts.

- [ ] **Step 4: Verify local and container MCP behavior**

Run: `npm run smoke && npm run docker:smoke`

Expected: both runs report every protocol check as PASS and finish with
`smoke ok`.

- [ ] **Step 5: Commit the smoke adapter**

```bash
git add scripts/smoke.mjs scripts/docker-smoke.mjs
git commit -m "test: exercise MCP through Docker stdio"
```

### Task 4: Gate artifacts in CI and publish releases

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: npm scripts from Tasks 1-3 and `vMAJOR.MINOR.PATCH` Git tags
- Produces: PR artifact checks, OIDC npm releases, and multi-platform GHCR images

- [ ] **Step 1: Resolve immutable action revisions**

Use `git ls-remote` against official action repositories to resolve the selected
major-version tags. Record the commit SHA next to a version comment for every new
workflow action.

- [ ] **Step 2: Add CI artifact checks**

Extend CI so Node 24 runs `npm run smoke` and `npm run package:check`. Add a
separate Docker job that builds `team-relay-mcp:test` and runs
`npm run docker:smoke` without registry login or push permissions.

- [ ] **Step 3: Add the release gate and npm job**

Create a release workflow triggered by tags matching `v[0-9]+.[0-9]+.[0-9]+`.
The gate checks out the exact tag, installs locked dependencies, verifies
`GITHUB_REF_NAME` against `package.json#version`, and runs format, typecheck,
tests, build, smoke, and package checks. The npm job depends on the gate, grants
only `contents: read` and `id-token: write`, installs a trusted-publishing-capable
npm 11 release, and runs:

```bash
npm publish --access public --provenance
```

- [ ] **Step 4: Add the GHCR job**

The container job depends on the gate, grants `contents: read` and
`packages: write`, signs in to `ghcr.io` with `github.actor` and
`secrets.GITHUB_TOKEN`, and publishes `linux/amd64,linux/arm64` tags for the exact
version, major/minor, major, and `latest`.

- [ ] **Step 5: Validate workflow structure**

Parse both YAML files locally and inspect the release trigger, permissions,
dependency gates, image name, platforms, and publish command. Run
`git diff --check`.

- [ ] **Step 6: Commit CI and release automation**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "ci: publish npm and GHCR releases"
```

### Task 5: Document npm, Docker, and owner release flows

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: final commands and artifact names from Tasks 1-4
- Produces: matching Korean and English installation, container, and maintainer instructions

- [ ] **Step 1: Add Korean Docker usage**

Document local build, GHCR pull/run, absolute read/write project mount, runtime
`DISCORD_BOT_TOKEN`, `-i` for MCP stdio, and container forms of `init` and
`doctor`. Explain the Linux UID/GID override.

- [ ] **Step 2: Add matching English Docker usage**

Mirror the same commands and constraints in the English section without
changing the existing product behavior claims.

- [ ] **Step 3: Add the maintainer release procedure**

Document the one-time npm bootstrap:

```bash
npm login
npm run format:check
npm run typecheck
npm test
npm run build
npm run smoke
npm run package:check
npm publish --access public --provenance
```

Then document npm Trusted Publisher configuration for repository
`slihump/team-relay-mcp` and workflow `release.yml`, plus the later version bump,
commit, annotated tag, and tag push sequence.

- [ ] **Step 4: Verify documentation commands and formatting**

Run: `npm run format:check`

Run every non-publishing README command used for package and container checks.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain npm and Docker releases"
```

### Task 6: Final verification and review

**Files:**
- Review: all files changed since `415e4ba`

**Interfaces:**
- Consumes: all implementation tasks
- Produces: a reviewed branch with evidence for every design requirement

- [ ] **Step 1: Run the complete verification suite fresh**

```bash
npm run format:check
npm run typecheck
npm test
npm run build
npm run smoke
npm run package:check
npm run docker:build
npm run docker:smoke
git diff --check 415e4ba..HEAD
```

Expected: all commands exit 0; 69 tests pass; local and Docker smoke checks pass.

- [ ] **Step 2: Confirm repository hygiene**

Run `git status --short`, `git log --oneline 415e4ba..HEAD`, and inspect the npm
tarball file list and final Docker image configuration. Confirm that the only
uncommitted path is the user's pre-existing `.gitignore` edit.

- [ ] **Step 3: Request an independent code review**

Review the changes from base `415e4ba` to `HEAD` against the design spec. Resolve
all Critical and Important findings, then rerun affected checks.

- [ ] **Step 4: Complete the development branch workflow**

Use `superpowers:finishing-a-development-branch` to present the verified
integration choices. Do not publish npm, push the Git tag, or publish GHCR until
the user selects the corresponding external release action and npm bootstrap
credentials exist.
