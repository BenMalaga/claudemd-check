import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { evaluateAssertions } from "./assert.js";

// One scenario run: build a fresh workspace (fixture dir and/or inline files +
// the CLAUDE.md under test), run `claude -p` headless inside it, capture the
// full stream-json transcript, evaluate assertions, clean up.
export function runScenarioOnce(scenario, cfg, { claudemdText, projectDir, claudeBin = "claude" }) {
  const workdir = mkdtempSync(join(tmpdir(), "claudemd-check-"));
  try {
    if (scenario.fixture) {
      cpSync(resolve(projectDir, scenario.fixture), workdir, { recursive: true });
    }
    for (const [rel, content] of Object.entries(scenario.files || {})) {
      const p = join(workdir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    // The CLAUDE.md under test always wins over any fixture copy.
    writeFileSync(join(workdir, "CLAUDE.md"), claudemdText);

    const args = [
      "-p",
      scenario.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--max-turns",
      String(cfg.maxTurns),
      "--allowedTools",
      cfg.allowedTools.join(","),
    ];
    if (cfg.model) args.push("--model", cfg.model);

    // Children are real headless agent sessions. Drop the CLAUDECODE recursion
    // guard so the harness also works when invoked FROM a Claude Code session
    // (the guard's own error message documents unsetting it as the bypass).
    const env = { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const r = spawnSync(claudeBin, args, {
      cwd: workdir,
      encoding: "utf8",
      timeout: (scenario.timeoutSec ?? 300) * 1000,
      maxBuffer: 64 * 1024 * 1024,
      env,
    });

    if (r.error || r.status !== 0) {
      const reason = r.error?.code === "ETIMEDOUT" ? "agent run timed out" : `claude exited ${r.status}${lastLine(r.stderr)}`;
      return { ok: false, error: reason, pass: false, results: [] };
    }

    const transcript = buildTranscript(r.stdout || "");
    const evaluated = evaluateAssertions(scenario.assert, { transcript, workdir });
    return { ok: true, ...evaluated };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

export function loadClaudemd(projectDir, claudemdPath) {
  const p = resolve(projectDir, claudemdPath);
  if (!existsSync(p)) throw new Error(`${claudemdPath} not found in ${projectDir} — claudemd-check tests YOUR instructions file; point --claudemd at it.`);
  return readFileSync(p, "utf8");
}

// The transcript that assertions see: the agent's OWN actions only — assistant
// text and tool invocations (name + input). System events, CLAUDE.md echoes,
// and tool RESULTS are excluded, so a rule like "never say X" isn't false-
// flagged by the agent reading the rule itself or by file contents flowing back.
export function buildTranscript(streamJson) {
  const parts = [];
  for (const line of streamJson.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type !== "assistant") continue;
    for (const block of ev.message?.content || []) {
      if (block.type === "text" && block.text) parts.push(block.text);
      else if (block.type === "tool_use") parts.push(`[tool:${block.name}] ${JSON.stringify(block.input)}`);
    }
  }
  return parts.join("\n");
}

function lastLine(s) {
  const t = (s || "").trim().split("\n").pop();
  return t ? `: ${t.slice(0, 160)}` : "";
}
