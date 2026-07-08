# Contributing

Thanks for helping people understand code they didn't write. This guide gets
you from clone to merged PR with no surprises.

## Setup (under 10 minutes)

Requirements: **Node ≥ 20.19** and **pnpm 10** (`corepack enable` gives you the
right pnpm automatically).

```bash
git clone https://github.com/georgyia/surrounded-by-slop.git
cd surrounded-by-slop
pnpm install
pnpm test        # everything green? you're ready
```

To run the extension: open the repo in VS Code and press **F5** — an Extension
Development Host starts with the extension loaded. (Until the first
visualization command lands, activation is deliberately a no-op.)

### Everyday commands

| Command          | What it does                                    |
| ---------------- | ----------------------------------------------- |
| `pnpm build`     | Build all packages                              |
| `pnpm typecheck` | `tsc --noEmit` across the workspace             |
| `pnpm lint`      | Biome check (lint + format + import order)      |
| `pnpm lint:fix`  | Auto-fix everything fixable                     |
| `pnpm test`      | Vitest with coverage gates                      |
| `pnpm package`   | Build a `.vsix` you can install in VS Code      |

## Project layout

```
packages/
  core/        # source → Semantic Graph IR → exporters. Pure TS. No `vscode`, no fs, no UI.
  extension/   # VS Code host: commands, webview panel, settings, file IO.
  webview/     # diagram UI: layout, SVG rendering, pan/zoom, interactions.
```

The dependency direction is one-way: `extension` and `webview` may depend on
`core`; `core` depends on nothing editor-related. CI and reviewers enforce
this.

## The rules

These apply to every contribution, including the maintainers':

1. **It works, or it doesn't merge.** `main` is releasable at every commit.
2. **Tested means tested.** Features ship with tests that fail without the
   change. `packages/core` holds ≥ 90% coverage, the repo ≥ 80% — CI enforces
   both. Bug fixes start with a failing regression test.
3. **Minimal.** Every new dependency needs a justification in the PR
   description. Prefer the standard library; prefer 100 lines we own over
   10,000 we import.
4. **Clean.** Strict TypeScript, no `any`, no `@ts-ignore` without a linked
   issue. Formatting is Biome's job, not a review topic.
5. **Deterministic.** Same input → byte-identical output (graphs, layouts,
   exports). Diagrams must be diffable in Git. Use `stableStringify` from
   `@surrounded-by-slop/core` for anything serialized.
6. **Small PRs.** One concern per PR. If it needs a tour guide, split it.
7. **No dead code**, no commented-out code, no `TODO` without an issue number.
8. **Privacy is a feature.** No telemetry, no network calls. A PR that phones
   home will be closed, gently but firmly.
9. **Docs are part of the feature.** User-facing changes update README/docs in
   the same PR.

AI-assisted contributions are welcome — this project exists *because* of
AI-written code. The bar doesn't move either way: it works, it's tested, it's
minimal, you understand it well enough to defend it in review.

## Tests & fixtures

- Unit tests live next to the code: `foo.ts` → `foo.test.ts`, and import
  through the package's public entry (`./index.js`) when testing public API.
- Analyzer behavior is tested with golden fixtures — see
  [packages/core/fixtures/README.md](packages/core/fixtures/README.md).

## Commits & PRs

- **Conventional Commits** for commit messages and PR titles:
  `feat: …`, `fix: …`, `docs: …`, `chore: …`, `test: …`, `ci: …`.
- **DCO sign-off is required** on every commit — it certifies you have the
  right to contribute the code ([developercertificate.org](https://developercertificate.org)):

  ```bash
  git commit -s -m "feat: add mermaid exporter"
  # forgot? amend it:
  git commit --amend -s --no-edit
  ```

  CI rejects unsigned commits.
- Branch from `main`, open a PR, fill the template. One approval merges;
  squash-merge keeps history linear.
- User-facing change? Add a changeset: `pnpm changeset`.

## Reporting bugs

Use the issue templates. The single most valuable thing you can include: the
**smallest code sample** that produces the wrong diagram, plus what you
expected to see.

## Code of Conduct

Be excellent to each other — formally: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
