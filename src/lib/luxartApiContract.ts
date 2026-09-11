type Environment = Record<string, string | undefined>;

export const supportedLuxartApiContract = "memberzone_rest_v1" as const;
export type LuxartApiContract = typeof supportedLuxartApiContract;

export function luxartApiContract(environment: Environment = process.env): LuxartApiContract | "invalid" {
  return environment.LUXART_API_CONTRACT === supportedLuxartApiContract
    ? supportedLuxartApiContract
    : "invalid";
}

export function assertSupportedLuxartApiContract(environment: Environment = process.env): LuxartApiContract {
  const contract = luxartApiContract(environment);
  if (contract === "invalid") {
    throw new Error(`LUXART_API_CONTRACT must exactly equal ${supportedLuxartApiContract}.`);
  }
  return contract;
}
