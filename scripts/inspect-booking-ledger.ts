import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

interface InspectionRow {
  user_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  operation: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function inspectBookingLedger(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const counts = await client.query<{ status: string; count: string }>(
      "SELECT status, count(*)::text AS count FROM zone4you_booking_mutations GROUP BY status ORDER BY status",
    );
    const rows = await client.query<InspectionRow>(
      `SELECT user_id, idempotency_key, request_fingerprint, operation, status, created_at, updated_at
       FROM zone4you_booking_mutations WHERE status IN ('processing', 'uncertain')
       ORDER BY updated_at, id LIMIT 100`,
    );
    await client.query("COMMIT");
    const unresolvedCount = counts.rows.filter((r) => ["processing", "uncertain"].includes(r.status))
      .reduce((sum, r) => sum + Number(r.count), 0);
    return {
      ok: true, checkedAt: new Date().toISOString(), readOnly: true,
      counts: Object.fromEntries(counts.rows.map((r) => [r.status, Number(r.count)])),
      truncated: unresolvedCount > rows.rows.length,
      unresolved: rows.rows.map((r) => ({
        userIdSha256: hash(r.user_id), idempotencyKeySha256: hash(r.idempotency_key),
        mutationFingerprint: r.request_fingerprint, operation: r.operation, status: r.status,
        createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.ZONE4YOU_LEDGER_INSPECTION_DATABASE_URL;
  if (!url) {
    console.error(JSON.stringify({ ok: false, code: "INSPECTION_DATABASE_REQUIRED" }));
    process.exitCode = 1;
  } else {
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
    inspectBookingLedger(pool).then((report) => console.log(JSON.stringify(report, null, 2)))
      .catch(() => { console.error(JSON.stringify({ ok: false, code: "LEDGER_INSPECTION_FAILED" })); process.exitCode = 1; })
      .finally(() => pool.end());
  }
}
