type Environment = Record<string, string | undefined>;

export type LuxartGatewayAuthMode = "none" | "basic" | "bearer" | "header";

export interface LuxartGatewayAuthConfig {
  mode: LuxartGatewayAuthMode;
  headers: Record<string, string>;
}

const authVariableNames = [
  "LUXART_API_BASIC_USERNAME",
  "LUXART_API_BASIC_PASSWORD",
  "LUXART_API_BEARER_TOKEN",
  "LUXART_API_AUTH_HEADER_NAME",
  "LUXART_API_AUTH_HEADER_VALUE",
] as const;

function required(environment: Environment, name: string) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required for the selected Luxart gateway auth mode.`);
  return value;
}

function safeSecret(value: string, name: string, maximumLength = 2048) {
  if (value.length > maximumLength || /[\r\n\0]/.test(value)) {
    throw new Error(`${name} contains an invalid control character or is too long.`);
  }
  return value;
}

function rejectUnused(environment: Environment, used: ReadonlySet<string>) {
  const unused = authVariableNames.filter((name) => environment[name] && !used.has(name));
  if (unused.length > 0) {
    throw new Error(`Unused Luxart gateway auth variables are configured: ${unused.join(", ")}.`);
  }
}

export function loadLuxartGatewayAuthConfig(environment: Environment = process.env): LuxartGatewayAuthConfig {
  const rawMode = environment.LUXART_API_AUTH_MODE?.trim().toLowerCase() || "none";
  if (!(["none", "basic", "bearer", "header"] as string[]).includes(rawMode)) {
    throw new Error("LUXART_API_AUTH_MODE must be none, basic, bearer or header.");
  }
  const mode = rawMode as LuxartGatewayAuthMode;

  if (mode === "none") {
    rejectUnused(environment, new Set());
    return { mode, headers: {} };
  }

  if (mode === "basic") {
    const username = safeSecret(required(environment, "LUXART_API_BASIC_USERNAME"), "LUXART_API_BASIC_USERNAME", 256);
    const password = safeSecret(required(environment, "LUXART_API_BASIC_PASSWORD"), "LUXART_API_BASIC_PASSWORD");
    if (username.includes(":")) throw new Error("LUXART_API_BASIC_USERNAME must not contain a colon.");
    rejectUnused(environment, new Set(["LUXART_API_BASIC_USERNAME", "LUXART_API_BASIC_PASSWORD"]));
    return {
      mode,
      headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}` },
    };
  }

  if (mode === "bearer") {
    const token = safeSecret(required(environment, "LUXART_API_BEARER_TOKEN"), "LUXART_API_BEARER_TOKEN", 4096);
    if (/\s/.test(token)) throw new Error("LUXART_API_BEARER_TOKEN must not contain whitespace.");
    rejectUnused(environment, new Set(["LUXART_API_BEARER_TOKEN"]));
    return { mode, headers: { Authorization: `Bearer ${token}` } };
  }

  const name = required(environment, "LUXART_API_AUTH_HEADER_NAME");
  const value = safeSecret(required(environment, "LUXART_API_AUTH_HEADER_VALUE"), "LUXART_API_AUTH_HEADER_VALUE", 4096);
  if (!/^X-[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(name)) {
    throw new Error("LUXART_API_AUTH_HEADER_NAME must be a valid X- prefixed HTTP header name.");
  }
  rejectUnused(environment, new Set(["LUXART_API_AUTH_HEADER_NAME", "LUXART_API_AUTH_HEADER_VALUE"]));
  return { mode, headers: { [name]: value } };
}

export function assertConfirmedLuxartGatewayAuth(environment: Environment = process.env) {
  if (environment.LUXART_API_AUTH_CONFIRMED !== "true") {
    throw new Error("LUXART_API_AUTH_CONFIRMED must be true only after IT confirms the gateway auth mode.");
  }
  if (!environment.LUXART_API_AUTH_MODE?.trim()) {
    throw new Error("LUXART_API_AUTH_MODE must be explicit when gateway authentication is confirmed.");
  }
  return loadLuxartGatewayAuthConfig(environment);
}
