# @surrounded-by-slop/cli

Headless semantic code maps for AI agents and CI. Analysis runs locally: no
telemetry, network service, or source upload.

## Quick start

```sh
npx @surrounded-by-slop/cli map
npx @surrounded-by-slop/cli query callers chargePayment
git diff | npx @surrounded-by-slop/cli impact -
```

The installed binary is `sbs`:

```text
sbs map [path] [--budget 2000] [--json]
sbs query defs|callers|callees|importers|slice|path ...
sbs impact [--staged|--diff <ref>|-]
sbs analyze [path]
sbs export --format mermaid|json [path]
sbs mcp [path]
```

TypeScript and JavaScript use typed compiler resolution. Python edges produced
by tree-sitter heuristics carry low-confidence metadata rather than pretending
to have type information.

Requires Node.js 20.19 or newer. See the
[repository documentation](https://github.com/georgyia/surrounded-by-slop)
for flags, examples, the Semantic Graph IR, and the VS Code extension.
