import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const fullCommitSha = /^[a-f0-9]{40}$/;

test("remote GitHub Actions are pinned to immutable full commit SHAs", () => {
  const workflowDirectory = resolve(".github/workflows");
  const workflowFiles = readdirSync(workflowDirectory)
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort();

  assert.ok(workflowFiles.length > 0, "No GitHub Actions workflows were found.");

  for (const fileName of workflowFiles) {
    const lines = readFileSync(resolve(workflowDirectory, fileName), "utf8").split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const action = line.match(/^\s*uses:\s*([^\s#]+)/)?.[1];
      if (!action || action.startsWith("./") || action.startsWith("docker://")) continue;

      const separator = action.lastIndexOf("@");
      const reference = separator >= 0 ? action.slice(separator + 1) : "";
      assert.match(
        reference,
        fullCommitSha,
        `${fileName}:${index + 1} must pin ${action} to a full 40-character commit SHA.`,
      );
    }
  }
});
