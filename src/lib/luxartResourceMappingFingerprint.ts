import { createHash } from "node:crypto";
import { parseLuxartResourceMapping } from "./luxartMappings";

export function luxartResourceMappingSha256(
  raw: string | undefined,
  variableName = "LUXART_RESOURCE_MAP_JSON",
) {
  const mapping = parseLuxartResourceMapping(raw, variableName);
  const canonical = Object.entries(mapping)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([roomNumber, resourceId]) => `${roomNumber}\0${resourceId}`)
    .join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
