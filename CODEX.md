# Built with Codex & GPT‑5.6 — and built *for* it

> **Submission note for the OpenAI Codex hackathon.** This file documents how
> [surrounded‑by‑slop](README.md) uses OpenAI Codex and GPT‑5.6. The story runs
> both ways: the project was **built with** Codex as a pair‑programmer, and it
> **ships an interface built for** Codex/GPT‑5.6 — so the tool that makes slop
> legible to humans hands that same map to the model.

---

## TL;DR

Somewhere around 2023, code stopped being *written* and started being
*generated*. Humans aren't the only ones drowning in it — **an LLM dropped into a
3,000‑line repo has the same problem you do: it can't read its way to
understanding.** So this project attacks the problem from both ends:

1. **Built *for* GPT‑5.6.** `surrounded‑by‑slop` ships an **Agent Interface** — an
   MCP server and a headless `sbs` CLI — that gives a model a *semantic graph* of
   any codebase: compiler‑resolved call edges, a token‑budgeted repo map, and the
   real blast‑radius of a diff. GPT‑5.6 reasons over **structure**, not a pile of
   files it had to guess about.
2. **Built *with* Codex.** Codex was the pair‑programmer, held to exactly the same
   quality bar as any human contributor — strict TypeScript, coverage the linter
   enforces, a written justification for every dependency. That's not a footnote;
   [it's a stated principle of the project](README.md#principles).

---

## 1. Built *for* Codex & GPT‑5.6 — the Agent Interface

This is real, in‑tree, and shipping — see commit `EPIC J · Agent Interface —
headless sbs CLI + MCP server`. Everything runs **locally**: no telemetry, no
network service, no source upload ([SECURITY.md](SECURITY.md), Rule 9).

### The MCP server — GPT‑5.6 gets native tools

```sh
sbs mcp [path]      # Model Context Protocol server over stdio
```

Instead of shelling out and parsing text, a Codex/GPT‑5.6 agent calls
`map`, `query`, and `impact` as **native MCP tools**
([`packages/cli/src/commands/mcp.ts`](packages/cli/src/commands/mcp.ts), SBS‑115).

### The three things a model actually needs

| `sbs` command | What GPT‑5.6 gets | Why it matters for an agent |
| --- | --- | --- |
| `map --budget <tokens>` | A **token‑budgeted** overview of the whole repo (SBS‑112) | The map *fits the context window*. The model sees the shape before spending tokens on files. |
| `query callers\|callees\|slice\|path …` | **Compiler‑resolved** graph queries (SBS‑113) | Edges come from the TypeScript type‑checker, not regex. The model gets ground truth — it can't hallucinate a call graph it was handed. |
| `impact --diff <ref>` / `impact -` | The **blast radius** of a change | Pipe a diff in; get what it actually affects. Exactly the question an agent should ask before editing. |

```sh
# What an agent does before touching a function it didn't write:
sbs query callers chargePayment          # who depends on this?
git diff | sbs impact -                   # what does my change ripple into?
sbs map --budget 2000 --json              # orient in a repo I've never seen
```

**The pitch in one line:** every reason a human can't read generated code —
too much of it, no ground truth, no idea what a change breaks — is a reason
GPT‑5.6 can't either. `surrounded‑by‑slop` is the map that fixes both.

---

## 2. Built *with* Codex & GPT‑5.6

The project treats AI‑assisted contribution as a first‑class workflow held to a
human bar — which is, pointedly, the whole thesis: *you can ship AI‑assisted code
that isn't slop, if the bar stays honest.*

> ✍️ **Fill in with your real specifics before sharing** — keep it truthful; judges
> will read the commits. Suggested points to cover (delete what doesn't apply):
>
> - **Where Codex drove.** Which packages / modules were built primarily with
>   Codex? (e.g. the `sbs` CLI command surface, the `impact` diff resolver, the
>   golden‑file test suites, the TypeScript adapter…)
> - **The GPT‑5.6 loop.** How you worked — spec → Codex draft → test → review.
>   What you used GPT‑5.6 for specifically (design discussion, refactors,
>   generating exhaustive tests, writing the exporters).
> - **The quality gate.** How Codex output was held to the same bar: strict TS,
>   Biome, coverage thresholds, 3‑OS CI. A generated PR that fails the gate
>   doesn't merge.
> - **A concrete example.** One feature, start to finish, with the commit(s):
>   what you asked, what Codex produced, what you changed, what shipped.

Anchor everything you write here to verifiable commits — e.g.:

```sh
git log --oneline            # the real trail
```

---

## 3. Why this is a Codex‑hackathon story, not just "an app built with Codex"

- **The method and the mission rhyme.** A tool that makes slop legible, built the
  modern (AI‑assisted) way, *and* handing that legibility back to the very agents
  generating the slop. It closes the loop.
- **It makes other agents better.** `sbs mcp` is a force multiplier for *any*
  Codex/GPT‑5.6 workflow on *any* repo — a reusable capability, not a one‑off demo.
- **It's honest about being AI‑built.** No "made by humans" theater. The claim is
  stronger: AI‑assisted code, held to a bar you can inspect, in a repo that
  documents its own architecture *by running itself*.

---

**Repo:** https://github.com/georgyia/surrounded-by-slop ·
**Agent Interface:** [`packages/cli`](packages/cli) ·
**The story:** [STORY.md](STORY.md)
