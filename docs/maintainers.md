# Maintainer Runbook

Operational knowledge that isn't code. Audit this after any GitHub settings
change.

## Repository settings checklist

**General**
- [x] Squash merge only (default commit message: PR title — must be a
      Conventional Commit)
- [x] Merge commits and rebase merge disabled
- [x] Automatically delete head branches
- [x] Discussions enabled
- [x] Projects/Wiki disabled (docs live in the repo)

**Branch protection — `main`**
- [x] Require a pull request before merging (1 approval)
- [x] Required status checks: `Lint & typecheck`, `Test (ubuntu-latest)`,
      `Test (macos-latest)`, `Test (windows-latest)`, `Package VSIX`,
      `DCO sign-off`
- [x] Require branches to be up to date before merging
- [x] No force pushes, no deletions
- Note: while the repo is **private on a free plan**, GitHub ignores branch
  protection — re-verify the moment the repo goes public.

**Security**
- [x] Private vulnerability reporting enabled
- [x] Dependabot alerts + security updates enabled
- [x] Secret scanning + push protection (automatic once public)

## Release runbook

1. Every user-facing PR added a changeset. Cut a release with:
   ```bash
   pnpm changeset version   # bumps versions, writes CHANGELOGs
   git commit -sam "chore: release"
   git tag v<extension-version>
   git push && git push --tags
   ```
2. The `Release` workflow then: verifies (lint/typecheck/test plus clean npm
   pack/install smoke tests), publishes `@surrounded-by-slop/core` and
   `@surrounded-by-slop/cli` with npm provenance, packages the VSIX, creates a
   GitHub Release, and publishes to the VS Code Marketplace and Open VSX when
   their tokens are configured. Without `NPM_TOKEN`, npm publication is a dry
   run so forks remain safe.

### Publishing tokens (one-time setup)

| Secret     | Where to get it |
| ---------- | --------------- |
| `VSCE_PAT` | Azure DevOps personal access token with **Marketplace → Manage** scope, for publisher `georgyia` (create the publisher once at marketplace.visualstudio.com/manage) |
| `OVSX_PAT` | open-vsx.org → user settings → Access Tokens (create the `georgyia` namespace first: `npx ovsx create-namespace georgyia -p <token>`) |
| `NPM_TOKEN` | npmjs.com access token allowed to publish the `@surrounded-by-slop` scope; configure 2FA for authorization-only or use a granular automation token |

### First npm publication and token rotation

Before the first tagged release, create or claim the `@surrounded-by-slop`
organization on npm, grant the publishing account access to both `core` and
`cli`, and add `NPM_TOKEN` as a repository Actions secret. Run `pnpm test:pack`
locally first; it audits archive contents and installs both tarballs into a
clean temporary project before invoking `npx --no-install sbs map .`.

The workflow publishes `core` before `cli` because the CLI declares the exact
workspace-rewritten core version. GitHub's OIDC token plus `--provenance`
attaches the repository/workflow attestation shown on npm. After the first
release, verify that provenance badge on both package pages. Rotate a granular
token in npm, replace the repository secret, run one tagged release, then
revoke the old token; never overlap valid tokens longer than that verification.

Until the npm secret exists, the release workflow performs public-package dry
runs with a notice; Marketplace and Open VSX publishing are skipped when their
respective tokens are absent.

## Cursor compatibility checklist

Run before every release (manual until automated). Install the freshly packaged
`.vsix` in **Cursor** (Extensions → … → Install from VSIX), open a TS/JS
project, then:

- [ ] Extension activates without errors (Help → Toggle Developer Tools →
      console)
- [ ] **Slop: Visualize File** opens a diagram beside the editor
- [ ] Clicking a node jumps to its declaration; the diagram refreshes on save
- [ ] **Slop: Visualize Workspace** produces the collapsed module map, and its
      progress notification cancels cleanly
- [ ] **Slop: Export Diagram As…** writes `.drawio` / `.mmd` / `.svg` / `.json`;
      **Copy Diagram as Mermaid** pastes into a GitHub comment
- [ ] Theme switching works, and `slop.*` settings apply on the next render

Cursor tracks VS Code with a lag, so the extension uses only stable APIs — no
`enableProposedApi`, and every editor API it calls predates its `engines.vscode`
floor (`^1.96.0`, a version Cursor already ships). Keep it that way.

## MCP server checklist (`sbs mcp`)

Run against a built CLI (`pnpm --filter @surrounded-by-slop/cli build`) before a
release that touches `packages/cli`. The server speaks newline-delimited
JSON-RPC 2.0 over stdio; it is local-only (no sockets, no network — Rule 9).

Quick smoke test from a shell:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node packages/cli/dist/bin.js mcp .
```

In **Claude Code**: `claude mcp add slop -- sbs mcp` (or point at
`node .../packages/cli/dist/bin.js mcp`), then in a session:

- [ ] `initialize` returns `protocolVersion` and `serverInfo.name = surrounded-by-slop`
- [ ] `tools/list` shows all 8 tools (repo_map, find_symbol, callers, callees,
      importers, slice, path, impact) with input schemas
- [ ] Calling `repo_map` returns a ranked map; `callers`/`callees`/`path` answer
- [ ] A bad symbol returns a tool result with `isError: true`, not a crash
- [ ] Editing a file mid-session is reflected on the next tool call (warm
      incremental re-analysis)
- [ ] Every response stays within the ~1500-token ceiling (oversized results end
      with a `… (truncated …)` notice)

In **Cursor**: add the same command under Settings → MCP, confirm the tools list
and a `callers` call.

## Issue triage

- First response within 48h, even if it's just a label.
- Bugs without a code sample → ask once, label `needs-repro`, close after 14
  quiet days.
- Questions → convert to Discussion.
- Every confirmed bug gets a fixture named after the behavior, not the issue.
