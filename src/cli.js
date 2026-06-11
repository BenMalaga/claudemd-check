import { argv, cwd, exit, stdout, stderr } from "node:process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { loadSpec } from "./spec.js";
import { runScenarioOnce, loadClaudemd } from "./run.js";

const VERSION = createRequire(import.meta.url)("../package.json").version;
const isTTY = Boolean(stdout.isTTY);
const C = isTTY
  ? { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m" }
  : { reset: "", bold: "", dim: "", red: "", green: "", yellow: "", cyan: "" };

function fail(msg) {
  stderr.write(`claudemd-check: ${msg}\n`);
  exit(2);
}

function parseArgs(args) {
  const o = { spec: "claudemd.test.json", claudemd: null, runs: null, json: false, saveBaseline: false, baseline: ".claudemd-baseline.json", model: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const take = () => args[++i] ?? fail(`${a} needs a value`);
    if (a === "--spec" || a === "-s") o.spec = take();
    else if (a === "--claudemd") o.claudemd = take();
    else if (a === "--runs" || a === "-n") o.runs = Number(take());
    else if (a === "--model" || a === "-m") o.model = take();
    else if (a === "--json") o.json = true;
    else if (a === "--save-baseline") o.saveBaseline = true;
    else if (a === "--baseline") o.baseline = take();
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a === "-v" || a === "--version") o.version = true;
    else fail(`unknown option: ${a}`);
  }
  return o;
}

function printHelp() {
  stdout.write(`claudemd-check ${VERSION} — regression tests for your CLAUDE.md.

Your CLAUDE.md says "always use pnpm" and "never commit to main" — but does
Claude actually obey, and did your last edit (or a model update) silently break
rule 7? claudemd-check runs scenario probes against real headless Claude Code
sessions and reports per-rule adherence rates, with a baseline to diff against.

Usage:
  claudemd-check [options]            # runs claudemd.test.json against ./CLAUDE.md

Options:
  -s, --spec <file>      Scenario spec. Default: claudemd.test.json.
      --claudemd <file>  Instructions file under test. Default: CLAUDE.md (from spec).
  -n, --runs <n>         Runs per scenario (overrides spec). More runs = better stats.
  -m, --model <name>     Model override (e.g. haiku for cheap smoke runs).
      --save-baseline    Save this result as the baseline to compare against.
      --baseline <file>  Baseline path. Default: .claudemd-baseline.json.
      --json             Machine-readable output.
  -h, --help / -v, --version

Each agent session bills against YOUR Anthropic account — start with --runs 1
--model haiku while writing scenarios, then raise runs for trustworthy rates.

Exit codes: 0 all scenarios met their minPassRate · 1 some did not · 2 usage error.
`);
}

export async function main() {
  const o = parseArgs(argv.slice(2));
  if (o.version) return void stdout.write(`claudemd-check ${VERSION}\n`);
  if (o.help) return void printHelp();

  const projectDir = cwd();
  let spec;
  try {
    spec = loadSpec(resolve(projectDir, o.spec));
  } catch (e) {
    fail(e.message);
  }
  if (o.runs) spec.runsPerScenario = o.runs;
  if (o.model) spec.model = o.model;
  if (o.claudemd) spec.claudemd = o.claudemd;

  let claudemdText;
  try {
    claudemdText = loadClaudemd(projectDir, spec.claudemd);
  } catch (e) {
    fail(e.message);
  }

  stdout.write(`${C.bold}claudemd-check${C.reset} ${C.dim}v${VERSION} · ${spec.claudemd} · ${spec.scenarios.length} scenarios × ${spec.runsPerScenario} runs${spec.model ? ` · model ${spec.model}` : ""}${C.reset}\n\n`);

  const report = [];
  let anyBelow = false;

  for (const scenario of spec.scenarios) {
    stdout.write(`${C.bold}${scenario.id}${C.reset} ${C.dim}— ${scenario.rule}${C.reset}\n`);
    let passes = 0;
    const failures = [];
    for (let i = 1; i <= spec.runsPerScenario; i++) {
      if (isTTY) stdout.write(`  run ${i}/${spec.runsPerScenario}…`);
      const r = runScenarioOnce(scenario, spec, { claudemdText, projectDir });
      if (isTTY) stdout.write("\r\x1b[2K");
      if (r.pass) {
        passes++;
        stdout.write(`  ${C.green}✓${C.reset} ${C.dim}run ${i} adhered${C.reset}\n`);
      } else {
        const why = r.error || r.results.filter((x) => !x.pass).map((x) => x.detail).join("; ");
        failures.push(why);
        stdout.write(`  ${C.red}✗${C.reset} run ${i}: ${why}\n`);
      }
    }
    const rate = passes / spec.runsPerScenario;
    const ok = rate >= scenario.minPassRate;
    if (!ok) anyBelow = true;
    const color = ok ? C.green : C.red;
    stdout.write(`  ${color}${C.bold}adherence ${(rate * 100).toFixed(0)}%${C.reset} ${C.dim}(${passes}/${spec.runsPerScenario}, required ${(scenario.minPassRate * 100).toFixed(0)}%)${C.reset}\n\n`);
    report.push({ id: scenario.id, rule: scenario.rule, rate, passes, runs: spec.runsPerScenario, minPassRate: scenario.minPassRate, ok });
  }

  // Baseline: compare, then optionally save.
  const baselinePath = resolve(projectDir, o.baseline);
  if (existsSync(baselinePath) && !o.saveBaseline) {
    try {
      const base = JSON.parse(readFileSync(baselinePath, "utf8"));
      const byId = new Map((base.scenarios || []).map((s) => [s.id, s]));
      const deltas = report
        .filter((r) => byId.has(r.id) && byId.get(r.id).rate !== r.rate)
        .map((r) => ({ id: r.id, from: byId.get(r.id).rate, to: r.rate }));
      if (deltas.length) {
        stdout.write(`${C.bold}vs baseline:${C.reset}\n`);
        for (const d of deltas) {
          const up = d.to > d.from;
          stdout.write(`  ${up ? C.green + "▲" : C.red + "▼"}${C.reset} ${d.id}: ${(d.from * 100).toFixed(0)}% → ${(d.to * 100).toFixed(0)}%\n`);
        }
        stdout.write("\n");
      }
    } catch {
      stdout.write(`${C.yellow}(could not read baseline ${o.baseline})${C.reset}\n`);
    }
  }
  if (o.saveBaseline) {
    writeFileSync(baselinePath, JSON.stringify({ savedAt: new Date().toISOString(), scenarios: report }, null, 2));
    stdout.write(`${C.dim}baseline saved to ${o.baseline}${C.reset}\n`);
  }

  if (o.json) stdout.write(JSON.stringify({ scenarios: report }, null, 2) + "\n");

  const total = report.length;
  const okCount = report.filter((r) => r.ok).length;
  stdout.write(`${C.bold}${okCount}/${total} scenarios met their adherence bar.${C.reset}\n`);
  exit(anyBelow ? 1 : 0);
}
