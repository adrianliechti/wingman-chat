import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateFiles, expectedFiles, initialFiles } from "./file-edit-scenario.mjs";

void test("scenario grader rejects unchanged inputs and accepts the intended rollout", () => {
  assert(evaluateFiles(initialFiles).passed < 8);
  assert.equal(evaluateFiles(expectedFiles()).passed, 8);
});

void test("scenario grader catches byte preservation, collateral edits and incorrect outputs", () => {
  const files = expectedFiles();
  files["/policy/returns.md"] = files["/policy/returns.md"].slice(1).replaceAll("\r\n", "\n");
  files["/archive/returns-2024.md"] = "modified";
  files["/exports/rollout.json"] = '{"euDays":45}';
  files["/extra.txt"] = "unexpected";
  const { checks } = evaluateFiles(files);
  assert.equal(checks.policyContent, true);
  for (const key of ["policyBom", "policyCrlf", "unrelatedFiles", "rollout", "exactFileSet"])
    assert.equal(checks[key], false);
});
