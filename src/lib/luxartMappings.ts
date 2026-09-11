type JsonMapping = Record<string, unknown>;

function parseJsonMapping(raw: string | undefined, variableName: string) {
  if (!raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${variableName} must contain a valid JSON object.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${variableName} must contain a JSON object.`);
  }
  const entries = Object.entries(value as JsonMapping);
  if (entries.length > 256) {
    throw new Error(`${variableName} contains too many mapping entries.`);
  }
  return entries;
}

function canonicalIntegerKey(key: string, minimum: number) {
  if (!/^\d+$/.test(key)) return false;
  const value = Number(key);
  return Number.isSafeInteger(value) && value >= minimum && String(value) === key;
}

export function parseLuxartTextMapping(raw: string | undefined, variableName: string) {
  const entries = parseJsonMapping(raw, variableName);
  if (!entries) return undefined;
  const normalized: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!canonicalIntegerKey(key, 0) || typeof value !== "string") {
      throw new Error(`${variableName} must map canonical non-negative Luxart IDs to text labels.`);
    }
    const label = value.trim();
    if (!label || label.length > 120 || /[\u0000-\u001f\u007f]/.test(label)) {
      throw new Error(`${variableName} contains an invalid display label.`);
    }
    normalized[key] = label;
  }
  return normalized;
}

export function parseLuxartResourceMapping(raw: string | undefined, variableName = "LUXART_RESOURCE_MAP_JSON") {
  const entries = parseJsonMapping(raw, variableName);
  if (!entries || entries.length === 0) {
    throw new Error(`${variableName} must contain at least one room mapping.`);
  }
  const normalized: Record<string, number> = {};
  for (const [key, value] of entries) {
    const resourceId = typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
    if (!canonicalIntegerKey(key, 1) || !Number.isSafeInteger(resourceId) || resourceId <= 0) {
      throw new Error(`${variableName} must map positive room numbers to positive Luxart resource IDs.`);
    }
    normalized[key] = resourceId;
  }
  return normalized;
}

export function validLuxartTextMapping(raw: string | undefined) {
  if (!raw) return true;
  try {
    parseLuxartTextMapping(raw, "Luxart text mapping");
    return true;
  } catch {
    return false;
  }
}

export function validLuxartResourceMapping(raw: string | undefined) {
  try {
    parseLuxartResourceMapping(raw);
    return true;
  } catch {
    return false;
  }
}
