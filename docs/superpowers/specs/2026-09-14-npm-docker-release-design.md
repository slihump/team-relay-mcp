# npm and Docker Release Design

## Goal

Make `team-relay-mcp` installable from the public npm registry and runnable as
a container, then publish both artifacts from version tags with reproducible
checks and provenance.

## Release model

The repository uses one version for both artifacts. A release tag has the form
`vMAJOR.MINOR.PATCH`, and the tag without its leading `v` must equal the
`version` in `package.json`. A mismatch stops the release before either
artifact is published.

Pull requests and pushes to `main` validate the npm package and build the
container. Version tags run the same validation before publishing:

1. Publish `team-relay-mcp@MAJOR.MINOR.PATCH` to the public npm registry.
2. Publish a multi-platform container to
   `ghcr.io/slihump/team-relay-mcp` for `linux/amd64` and `linux/arm64`.
3. Apply the full version, major/minor, major, and `latest` container tags.

The npm package does not exist yet, so its first version cannot use an npm
trusted-publisher relationship configured on the package. The bootstrap flow
is:

1. Run all release checks locally.
2. Sign in to npm and publish `1.0.0` once with public access. A local manual
   publish cannot carry the GitHub OIDC provenance used by later releases.
3. Configure npm Trusted Publishing for this GitHub repository and the release
   workflow file.
4. Publish later versions from GitHub Actions with OIDC and no long-lived npm
   token.

The repository documents the bootstrap as an owner action. Automation never
stores or requests the Discord bot token.

## npm artifact

The existing package metadata remains the source of truth. `prepublishOnly`
continues to build and test, while CI additionally inspects the packed tarball.
The tarball must contain the compiled CLI, package entry point, README,
LICENSE, and Claude guidance snippet. It must not contain source files, local
configuration, state, credentials, test fixtures, or conversation logs.

The release workflow uses Node 24 and a supported npm CLI, disables dependency
caching, grants `id-token: write`, and runs `npm publish --access public` only
after formatting, type checking, tests, build, smoke test, package-content
validation, and version/tag validation pass. npm Trusted Publishing adds the
provenance automatically. If the exact package version already exists, the npm
job reports and skips that idempotent publish so the matching container release
can still complete.

## Container artifact

The container uses a multi-stage Node 24 Alpine build. The build stage installs
locked dependencies with `npm ci`, compiles TypeScript, and removes development
dependencies. The runtime stage contains only production dependencies, `dist`,
package metadata, README, and LICENSE.

The image has these runtime properties:

- Executable: `node /app/dist/cli/main.js`
- Default command: `serve`
- Default working directory: `/workspace`
- Default user: the non-root `node` user
- MCP transport: stdio, requiring `docker run -i`
- Configuration and state: resolved from the mounted project directory, using
  the existing `.team-relay` rules
- Secrets: supplied at runtime through `DISCORD_BOT_TOKEN`; never copied into
  an image layer

All CLI commands remain available by replacing the default argument, including
`init`, `doctor`, and `--help`. A project using the image mounts its project
directory read/write at `/workspace`, because `state.json` and the configured
decision file are runtime outputs. Linux users whose host UID differs from the
image's `node` UID can pass an explicit `--user UID:GID`; the documentation
must explain this without embedding a machine-specific value in the image.

`.dockerignore` excludes Git data, dependency/build output, local environment
files, `.team-relay`, conversation logs, coverage, and editor/OS files from the
build context.

## GitHub Actions

The existing CI workflow gains two artifact checks:

- Build the Dockerfile on one architecture without pushing it.
- Pack the npm artifact and verify its public contents and executable entry.

A dedicated release workflow runs only for semantic version tags. It first
performs the full repository checks and verifies the version/tag match. Its npm
and container publishing jobs depend on that gate. The container job signs in
to GHCR with the repository-scoped `GITHUB_TOKEN`; no Docker Hub credentials
are required.

Actions are pinned to immutable commit SHAs where practical. Workflow
permissions are least-privilege and assigned per job: npm publication receives
`contents: read` and `id-token: write`; container publication receives
`contents: read` and `packages: write`.

## Documentation

The Korean and English README sections both describe:

- npm installation with `npm install -g team-relay-mcp` and zero-install use
  with `npx -y team-relay-mcp`
- local Docker build and published GHCR image use
- an MCP configuration that runs the image over stdio with an absolute project
  mount and runtime bot-token environment variable
- container forms of `init` and `doctor`
- writable-mount and Linux UID/GID requirements

A maintainer release section records the exact bootstrap and later tag-driven
release sequence. It makes clear that creating and pushing a release tag is an
external publication action.

## Verification

The completed change must pass all existing checks and these artifact-level
checks:

1. `npm run format:check`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. Existing MCP stdio smoke test
6. `npm pack --dry-run --json` content assertions
7. Install the generated tarball in a temporary directory and run the packaged
   CLI's `--help`
8. Build the Docker image from a clean build context
9. Run the container's `--help`
10. Start the container with the memory transport and complete an MCP
    initialize/list-tools smoke exchange over stdio

Release workflows are syntax-inspected locally. The actual npm and GHCR push
can only be verified after credentials and GitHub package permissions are in
place.

## Scope boundaries

This change packages the existing stdio MCP server. It does not add an HTTP
transport, alter the Discord protocol, change stored state formats, or modify
MCP tool behavior. Docker Compose and Docker Hub publication are outside this
release path because an MCP client manages the lifecycle of the stdio
container and GHCR already provides repository-scoped authentication.
