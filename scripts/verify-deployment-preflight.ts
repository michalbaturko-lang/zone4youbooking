import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildDeploymentPreflightReport,
  deploymentCliOnlyVariables,
  type DeploymentPreflightReport,
} from "../src/lib/deploymentPreflight";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceState(environment: Record<string, string | undefined>) {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const sourceChanges = execFileSync("git", ["status", "--porcelain"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(Boolean)
      .filter((line) => !line.startsWith("?? output/") && !line.startsWith("?? tmp/"));
    return { commit, sourceClean: sourceChanges.length === 0 };
  } catch {
    const platformCommit = environment.VERCEL_GIT_COMMIT_SHA?.trim();
    if (platformCommit && /^[a-f0-9]{40}$/i.test(platformCommit)) {
      return { commit: platformCommit.toLowerCase(), sourceClean: true };
    }
    throw new Error("Source commit is not available.");
  }
}

function operatorEnvironment(environment: Record<string, string | undefined>) {
  const runtime = { ...environment };
  for (const name of deploymentCliOnlyVariables) delete runtime[name];
  return runtime;
}

export function verifyDeploymentPreflight(
  environment: Record<string, string | undefined> = process.env,
  options: { operatorContext?: boolean } = {},
) {
  const source = sourceState(environment);
  const runtimeEnvironment = options.operatorContext ? operatorEnvironment(environment) : environment;
  const report = buildDeploymentPreflightReport(runtimeEnvironment, { expectedCommit: source.commit });
  if (!source.sourceClean) {
    const dirtySourceIssue: DeploymentPreflightReport["issues"][number] = {
      code: "SOURCE_WORKTREE_DIRTY",
      variables: [],
    };
    report.issues.push(dirtySourceIssue);
    report.issues.sort((a, b) => a.code.localeCompare(b.code));
    report.ok = false;
  }
  return report;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    const report = verifyDeploymentPreflight(process.env, {
      operatorContext: process.argv.includes("--operator-context"),
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch {
    console.error(JSON.stringify({ ok: false, error: "Deployment preflight could not be evaluated safely." }));
    process.exitCode = 1;
  }
}
