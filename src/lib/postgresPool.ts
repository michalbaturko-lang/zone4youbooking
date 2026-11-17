import { Pool, type PoolConfig } from "pg";

export type DatabaseComponent = "booking" | "payments" | "rate-limit";

export function createRuntimePostgresPool(config: PoolConfig, component: DatabaseComponent) {
  const pool = new Pool({
    ...config,
    // Bound established queries as well as opening a new connection. The
    // server cancels first; the driver deadline also covers a lost response.
    statement_timeout: 5_000,
    query_timeout: 6_000,
  });
  pool.on("error", (error: Error & { code?: string }) => {
    console.error(JSON.stringify({
      event: "booking_database_pool_error", component,
      code: error.code && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : "DATABASE_CONNECTION_ERROR",
    }));
  });
  return pool;
}
