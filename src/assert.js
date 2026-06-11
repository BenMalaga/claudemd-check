import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Evaluate one scenario's assertions against a finished run: the transcript
// (every event the agent emitted, including tool inputs — so shell commands and
// file edits are visible to regexes) and the workspace directory it acted in.
// Pure-ish (filesystem reads + the explicit `command` assertion); unit-testable
// with a synthetic workspace and transcript string.
export function evaluateAssertions(asserts, { transcript, workdir }) {
  const results = [];
  for (const a of asserts) {
    results.push({ assert: a, ...evalOne(a, transcript, workdir) });
  }
  return { pass: results.every((r) => r.pass), results };
}

function evalOne(a, transcript, workdir) {
  switch (a.type) {
    case "transcript_match": {
      const ok = new RegExp(a.pattern, a.flags ?? "i").test(transcript);
      return { pass: ok, detail: ok ? "matched" : `transcript never matched /${a.pattern}/` };
    }
    case "transcript_not_match": {
      const m = transcript.match(new RegExp(a.pattern, a.flags ?? "i"));
      return { pass: !m, detail: m ? `transcript matched forbidden /${a.pattern}/ ("…${snippet(transcript, m.index)}…")` : "clean" };
    }
    case "file_exists": {
      const ok = existsSync(join(workdir, a.path));
      return { pass: ok, detail: ok ? "exists" : `${a.path} was not created` };
    }
    case "file_absent": {
      const ok = !existsSync(join(workdir, a.path));
      return { pass: ok, detail: ok ? "absent" : `${a.path} exists but should not` };
    }
    case "file_contains": {
      const p = join(workdir, a.path);
      if (!existsSync(p)) return { pass: false, detail: `${a.path} does not exist` };
      const ok = new RegExp(a.pattern, a.flags ?? "i").test(readFileSync(p, "utf8"));
      return { pass: ok, detail: ok ? "matched" : `${a.path} never matched /${a.pattern}/` };
    }
    case "file_not_contains": {
      const p = join(workdir, a.path);
      if (!existsSync(p)) return { pass: false, detail: `${a.path} does not exist` };
      const m = readFileSync(p, "utf8").match(new RegExp(a.pattern, a.flags ?? "i"));
      return { pass: !m, detail: m ? `${a.path} contains forbidden /${a.pattern}/` : "clean" };
    }
    case "command": {
      const r = spawnSync(a.run, { cwd: workdir, shell: true, encoding: "utf8", timeout: a.timeout ?? 60000 });
      const ok = r.status === 0;
      return { pass: ok, detail: ok ? "exit 0" : `"${a.run}" exited ${r.status}${trim(r.stderr)}` };
    }
    default:
      return { pass: false, detail: `unknown assertion type ${a.type}` };
  }
}

function snippet(text, idx) {
  return text.slice(Math.max(0, idx - 20), idx + 40).replace(/\s+/g, " ");
}

function trim(s) {
  const t = (s || "").trim().split("\n").pop();
  return t ? `: ${t.slice(0, 120)}` : "";
}
