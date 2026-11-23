/** One row per tool call, success or failure. Raw arguments are NOT stored, only a hash. */
export interface AuditRow {
  at: string;
  tenantId: string | null; // null only when the call never authenticated
  userId: string | null;
  clientId: string | null;
  tool: string;
  argHash: string;
  idempotencyKey: string | null;
  replay: boolean;
  status: 'ok' | 'denied' | 'invalid' | 'not_found' | 'conflict' | 'rate_limited' | 'error';
  latencyMs: number;
}

export interface AuditSink { write(row: AuditRow): void }

export class MemoryAudit implements AuditSink {
  rows: AuditRow[] = [];
  write(row: AuditRow) { this.rows.push(row); }
}

/** Default sink: one JSON line per call on stdout. Swap for a database table. */
export class StdoutAudit implements AuditSink {
  write(row: AuditRow) { process.stdout.write(JSON.stringify({ audit: row }) + '\n'); }
}
