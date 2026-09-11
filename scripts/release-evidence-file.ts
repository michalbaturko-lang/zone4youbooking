import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

export interface ReleaseEvidenceFileOptions {
  maximumBytes?: number;
  ownerOnly?: boolean;
}

export interface StableJsonFile {
  bytes: Buffer;
  data: unknown;
  sha256: string;
}

const defaultMaximumBytes = 256 * 1024;

function changedDuringRead(before: ReturnType<typeof fstatSync>, after: ReturnType<typeof fstatSync>, bytes: Buffer) {
  return (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mode !== after.mode ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    bytes.length !== after.size
  );
}

export function readStableReleaseJson(
  path: string,
  label: string,
  options: ReleaseEvidenceFileOptions = {},
): StableJsonFile {
  const maximumBytes = options.maximumBytes ?? defaultMaximumBytes;
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error(`${label} must be an existing regular file, not a symlink.`);
  }

  let bytes: Buffer;
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile()) throw new Error(`${label} must be a regular file, not a symlink.`);
    if (before.size < 2 || before.size > maximumBytes) {
      throw new Error(`${label} must contain between 2 and ${maximumBytes} bytes.`);
    }
    if (options.ownerOnly) {
      if ((before.mode & 0o077) !== 0) {
        throw new Error(`${label} must not be accessible by group or other users.`);
      }
    } else if ((before.mode & 0o022) !== 0) {
      throw new Error(`${label} must not be writable by group or other users.`);
    }

    bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (changedDuringRead(before, after, bytes)) {
      throw new Error(`${label} changed while it was being read.`);
    }
  } finally {
    closeSync(descriptor);
  }

  let data: unknown;
  try {
    data = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  return {
    bytes,
    data,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
