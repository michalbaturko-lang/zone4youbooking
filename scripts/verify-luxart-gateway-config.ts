import { pathToFileURL } from "node:url";
import { assertConfirmedLuxartGatewayAuth } from "../src/lib/luxartGatewayAuth";

export function verifyLuxartGatewayConfiguration(environment: Record<string, string | undefined> = process.env) {
  const config = assertConfirmedLuxartGatewayAuth(environment);
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    gatewayAuthMode: config.mode,
    authorizationHeaderConfigured: Object.keys(config.headers).length === 1,
    gatewayDecisionConfirmed: true,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    console.log(JSON.stringify(verifyLuxartGatewayConfiguration(), null, 2));
  } catch (error) {
    console.error(`Luxart gateway configuration verification failed: ${error instanceof Error ? error.message : "Unknown error."}`);
    process.exitCode = 1;
  }
}
