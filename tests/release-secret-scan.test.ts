import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scanRepositorySecrets } from "../scripts/scan-release-secrets.mjs";

function git(directory: string, args: string[]) {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8" });
}

function repositoryFixture() {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-secret-scan-"));
  git(directory, ["init", "-q"]);
  git(directory, ["config", "user.email", "test@example.invalid"]);
  git(directory, ["config", "user.name", "Zone4You test"]);
  writeFileSync(join(directory, "safe.txt"), "no production credentials here\n", "utf8");
  git(directory, ["add", "safe.txt"]);
  git(directory, ["commit", "-qm", "safe baseline"]);
  return directory;
}

test("release secret scan accepts a clean working tree and history", () => {
  const directory = repositoryFixture();
  try {
    const result = scanRepositorySecrets({ repositoryRoot: directory });
    assert.equal(result.ok, true);
    assert.equal(result.historyIncluded, true);
    assert.equal(result.issues.length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("release secret scan detects a known Luxart credential after it was removed from HEAD", () => {
  const directory = repositoryFixture();
  try {
    const exposedLogin = ["olbik", "@", "seznam", ".", "cz"].join("");
    writeFileSync(join(directory, "temporary.txt"), `${exposedLogin}\n`, "utf8");
    git(directory, ["add", "temporary.txt"]);
    git(directory, ["commit", "-qm", "temporary mistake"]);
    git(directory, ["rm", "-q", "temporary.txt"]);
    git(directory, ["commit", "-qm", "remove temporary file"]);

    const result = scanRepositorySecrets({ repositoryRoot: directory });
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) =>
      issue.rule === "KNOWN_EXPOSED_LUXART_TEST_CREDENTIAL" && issue.source.startsWith("history:")), true);
    assert.equal(JSON.stringify(result).includes(exposedLogin), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
