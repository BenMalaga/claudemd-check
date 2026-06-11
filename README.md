<div align="center">

# claudemd-check

### Regression tests for your CLAUDE.md.

Your instructions file says *"always use pnpm"*, *"never commit to main"*,
*"every new file ends with a license header"* — but do you actually know which
rules your agent obeys, how often, and whether last week's edit (or a model
update) **silently broke rule 7?**

[![npm](https://img.shields.io/npm/v/claudemd-check?color=cb3837&label=npm)](https://www.npmjs.com/package/claudemd-check)
[![CI](https://github.com/BenMalaga/claudemd-check/actions/workflows/test.yml/badge.svg)](https://github.com/BenMalaga/claudemd-check/actions)
![node](https://img.shields.io/badge/node-%E2%89%A518-339933)
![deps](https://img.shields.io/badge/dependencies-0-success)
![license](https://img.shields.io/badge/license-MIT-yellow)

</div>

---

Every Claude Code user has a CLAUDE.md. Almost nobody tests it. Rules
accumulate, contradict, decay — and the only feedback loop is vibes. There are
eval harnesses for *skills* (skillgrade, promptfoo, Anthropic's skill-creator),
but the instructions file itself — the thing **every** session loads — has no
test runner.

claudemd-check is that runner. You write scenario probes (a prompt + the
deterministic footprint an *adherent* run leaves behind), it executes each one
N times against **real headless Claude Code sessions** in throwaway workspaces,
and reports per-rule adherence rates — diffed against a saved baseline, wired
for CI.

```
claudemd-check v0.1.0 · CLAUDE.md · 2 scenarios × 2 runs · model haiku

verified-trailer — New text files end with VERIFIED
  ✓ run 1 adhered
  ✓ run 2 adhered
  adherence 100% (2/2, required 100%)

no-delicious — Never use the word delicious
  ✗ run 1: pie.txt contains forbidden /delicious/
  ✓ run 2 adhered
  adherence 50% (1/2, required 100%)

vs baseline:
  ▼ no-delicious: 100% → 50%

1/2 scenarios met their adherence bar.
```

That `▼ 100% → 50%` line is the product: the CLAUDE.md edit you made this
morning just lost you a rule, and you found out from a red CI check instead of
three weeks of subtle damage.

## Install

```bash
npm install -g claudemd-check     # or npx claudemd-check
```

Requires [Claude Code](https://claude.com/claude-code) (`claude` on your PATH)
and Node ≥ 18. Zero npm dependencies.

> **Cost honesty:** every run is a real agent session billed to your Anthropic
> account/subscription. Write scenarios with `--runs 1 --model haiku`, then
> raise runs for statistically meaningful rates. Small scenarios on haiku cost
> on the order of a cent each.

## Writing scenarios

`claudemd.test.json`, next to the CLAUDE.md it tests
([full example](examples/claudemd.test.json)):

```json
{
  "runsPerScenario": 3,
  "model": "haiku",
  "allowedTools": ["Write", "Edit", "Read", "Bash"],
  "scenarios": [
    {
      "id": "always-pnpm",
      "rule": "Always use pnpm, never npm",
      "prompt": "add lodash to this project",
      "files": { "package.json": "{\"name\":\"demo\"}" },
      "assert": [
        { "type": "transcript_match", "pattern": "pnpm (add|install)" },
        { "type": "transcript_not_match", "pattern": "\\bnpm (install|i)\\b" },
        { "type": "file_absent", "path": "package-lock.json" }
      ]
    }
  ]
}
```

Each run gets a fresh temp workspace (inline `files` and/or a `fixture`
directory, plus the CLAUDE.md under test), so runs never contaminate each other
— or your repo.

**Assertions** (all deterministic — no LLM judges, no flaky grading):

| Type | Checks |
| --- | --- |
| `transcript_match` / `transcript_not_match` | Regex over **the agent's own actions** — its text and tool calls (commands run, files written). Deliberately excludes the rule text itself and tool results, so "never say X" isn't false-flagged by the agent reading the rule. |
| `file_exists` / `file_absent` | Workspace state after the run. |
| `file_contains` / `file_not_contains` | Regex over a produced file. |
| `command` | Any shell command, run in the workspace; exit 0 = pass. The escape hatch that can verify anything. |

## CI

```yaml
- run: npx claudemd-check            # exits 1 if any rule is below its bar
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Save a baseline once (`claudemd-check --save-baseline`, commit it), and every
subsequent run prints per-rule deltas — so a CLAUDE.md edit or a new model
release that drops "never touch main" from 100% to 60% **fails the build**, with
the rule named.

## Flags

`--spec <file>` · `--claudemd <file>` · `--runs N` · `--model <name>` ·
`--save-baseline` · `--baseline <file>` · `--json`

## Scope

claudemd-check tests **instruction adherence** in Claude Code. It does not test
skill triggering (use [skillgrade](https://github.com/mgechev/skillgrade) or
promptfoo for SKILL.md files) and does not grade output *quality* — it checks
the deterministic footprint of rule-following, which is what you can actually
regress on. Hooks and slash-command coverage are the roadmap.

## License

[MIT](LICENSE)
