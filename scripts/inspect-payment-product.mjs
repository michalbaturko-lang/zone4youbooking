import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const profile = JSON.parse(readFileSync(join(repositoryRoot, "config/payment-product-profile.json"), "utf8"));
const sha256 = createHash("sha256").update(JSON.stringify(profile), "utf8").digest("hex");

console.log(JSON.stringify({ profile, sha256 }, null, 2));
