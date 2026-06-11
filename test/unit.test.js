import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateAssertions } from "../src/assert.js";
import { validateSpec } from "../src/spec.js";

test("transcript_match / not_match", () => {
  const t = '{"type":"assistant","text":"I will run pnpm add lodash"}';
  const r = evaluateAssertions(
    [
      { type: "transcript_match", pattern: "pnpm add" },
      { type: "transcript_not_match", pattern: "\\bnpm install\\b" },
    ],
    { transcript: t, workdir: "/nonexistent" },
  );
  assert.equal(r.pass, true);
});

test("transcript_not_match fails with a snippet when forbidden text appears", () => {
  const r = evaluateAssertions([{ type: "transcript_not_match", pattern: "npm install" }], {
    transcript: "running npm install lodash now",
    workdir: "/nonexistent",
  });
  assert.equal(r.pass, false);
  assert.match(r.results[0].detail, /forbidden/);
});

test("file assertions against a real workspace", () => {
  const dir = mkdtempSync(join(tmpdir(), "cmc-test-"));
  try {
    writeFileSync(join(dir, "out.txt"), "hello VERIFIED world");
    const r = evaluateAssertions(
      [
        { type: "file_exists", path: "out.txt" },
        { type: "file_contains", path: "out.txt", pattern: "VERIFIED" },
        { type: "file_absent", path: "package-lock.json" },
      ],
      { transcript: "", workdir: dir },
    );
    assert.equal(r.pass, true);
    const bad = evaluateAssertions([{ type: "file_contains", path: "missing.txt", pattern: "x" }], { transcript: "", workdir: dir });
    assert.equal(bad.pass, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("command assertion uses exit code", () => {
  const dir = mkdtempSync(join(tmpdir(), "cmc-cmd-"));
  try {
    const ok = evaluateAssertions([{ type: "command", run: "exit 0" }], { transcript: "", workdir: dir });
    assert.equal(ok.pass, true);
    const bad = evaluateAssertions([{ type: "command", run: "exit 3" }], { transcript: "", workdir: dir });
    assert.equal(bad.pass, false);
    assert.match(bad.results[0].detail, /exited 3/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateSpec applies defaults and catches structural errors", () => {
  const good = validateSpec({
    scenarios: [{ id: "a", rule: "r", prompt: "p", assert: [{ type: "file_exists", path: "x" }] }],
  });
  assert.equal(good.runsPerScenario, 3);
  assert.equal(good.scenarios[0].minPassRate, 1);
  assert.ok(good.allowedTools.includes("Write"));

  assert.throws(() => validateSpec({ scenarios: [] }), /non-empty/);
  assert.throws(
    () => validateSpec({ scenarios: [{ id: "a", rule: "r", prompt: "p", assert: [{ type: "bogus" }] }] }),
    /unknown type/,
  );
  assert.throws(
    () =>
      validateSpec({
        scenarios: [
          { id: "dup", rule: "r", prompt: "p", assert: [{ type: "file_exists", path: "x" }] },
          { id: "dup", rule: "r", prompt: "p", assert: [{ type: "file_exists", path: "x" }] },
        ],
      }),
    /duplicate id/,
  );
});
