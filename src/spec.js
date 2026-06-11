import { readFileSync } from "node:fs";

// Spec format: a JSON file (default claudemd.test.json). Each scenario probes
// ONE rule from your CLAUDE.md with a concrete prompt and deterministic
// assertions about what an adherent agent run looks like.
//
// {
//   "runsPerScenario": 3,
//   "model": "haiku",                  // optional: passed to claude --model
//   "maxTurns": 10,
//   "allowedTools": ["Write", "Edit", "Bash", "Read"],
//   "scenarios": [
//     {
//       "id": "always-pnpm",
//       "rule": "Always use pnpm, never npm",
//       "prompt": "add lodash to this project",
//       "files": { "package.json": "{\"name\":\"x\"}" },   // inline fixture
//       "fixture": "./fixtures/js-app",                     // or a directory
//       "minPassRate": 1,
//       "assert": [
//         { "type": "transcript_match", "pattern": "pnpm (add|install)" },
//         { "type": "transcript_not_match", "pattern": "\\bnpm install\\b" },
//         { "type": "file_exists", "path": "pnpm-lock.yaml" },
//         { "type": "file_absent", "path": "package-lock.json" },
//         { "type": "file_contains", "path": "README.md", "pattern": "..." },
//         { "type": "command", "run": "node smoke.js" }     // exit 0 = pass
//       ]
//     }
//   ]
// }

const ASSERT_TYPES = new Set(["transcript_match", "transcript_not_match", "file_exists", "file_absent", "file_contains", "file_not_contains", "command"]);

export function loadSpec(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`spec file not found: ${path}`);
  }
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${e.message}`);
  }
  return validateSpec(spec, path);
}

export function validateSpec(spec, label = "spec") {
  const errors = [];
  if (!Array.isArray(spec.scenarios) || spec.scenarios.length === 0) {
    errors.push(`"scenarios" must be a non-empty array`);
  }
  const ids = new Set();
  for (const [i, s] of (spec.scenarios || []).entries()) {
    const where = `scenarios[${i}]`;
    if (!s.id) errors.push(`${where}: missing "id"`);
    else if (ids.has(s.id)) errors.push(`${where}: duplicate id "${s.id}"`);
    else ids.add(s.id);
    if (!s.rule) errors.push(`${where}: missing "rule" (which CLAUDE.md rule does this probe?)`);
    if (!s.prompt) errors.push(`${where}: missing "prompt"`);
    if (!Array.isArray(s.assert) || s.assert.length === 0) errors.push(`${where}: needs at least one assertion`);
    for (const [j, a] of (s.assert || []).entries()) {
      if (!ASSERT_TYPES.has(a.type)) errors.push(`${where}.assert[${j}]: unknown type "${a.type}"`);
      if (["transcript_match", "transcript_not_match"].includes(a.type) && !a.pattern) errors.push(`${where}.assert[${j}]: needs "pattern"`);
      if (["file_exists", "file_absent", "file_contains", "file_not_contains"].includes(a.type) && !a.path) errors.push(`${where}.assert[${j}]: needs "path"`);
      if (["file_contains", "file_not_contains"].includes(a.type) && !a.pattern) errors.push(`${where}.assert[${j}]: needs "pattern"`);
      if (a.type === "command" && !a.run) errors.push(`${where}.assert[${j}]: needs "run"`);
    }
    if (s.minPassRate != null && (typeof s.minPassRate !== "number" || s.minPassRate < 0 || s.minPassRate > 1))
      errors.push(`${where}: "minPassRate" must be 0..1`);
  }
  if (errors.length) throw new Error(`invalid ${label}:\n  - ${errors.join("\n  - ")}`);
  return {
    runsPerScenario: spec.runsPerScenario ?? 3,
    model: spec.model ?? null,
    maxTurns: spec.maxTurns ?? 10,
    allowedTools: spec.allowedTools ?? ["Write", "Edit", "Read", "Bash", "Glob", "Grep"],
    claudemd: spec.claudemd ?? "CLAUDE.md",
    scenarios: spec.scenarios.map((s) => ({ minPassRate: 1, files: {}, ...s })),
  };
}
