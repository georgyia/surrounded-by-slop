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
2. The `Release` workflow then: verifies (lint/typecheck/test), packages the
   VSIX, creates a GitHub Release with generated notes, and publishes to the
   VS Code Marketplace and Open VSX **if the tokens are configured**.

### Publishing tokens (one-time setup)

| Secret     | Where to get it |
| ---------- | --------------- |
| `VSCE_PAT` | Azure DevOps personal access token with **Marketplace → Manage** scope, for publisher `georgyia` (create the publisher once at marketplace.visualstudio.com/manage) |
| `OVSX_PAT` | open-vsx.org → user settings → Access Tokens (create the `georgyia` namespace first: `npx ovsx create-namespace georgyia -p <token>`) |

Until the secrets exist, the release workflow skips publishing with a notice —
it never fails because of missing tokens.

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

## Issue triage

- First response within 48h, even if it's just a label.
- Bugs without a code sample → ask once, label `needs-repro`, close after 14
  quiet days.
- Questions → convert to Discussion.
- Every confirmed bug gets a fixture named after the behavior, not the issue.
