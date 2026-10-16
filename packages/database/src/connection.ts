import { DatabaseSync, type StatementSync } from "node:sqlite";

export type SqlValue = string | number | bigint | null;
export type SqlParams = Record<string, SqlValue>;
export type Row = Record<string, unknown>;

/**
 * Thin wrapper over Node's built-in SQLite driver. Everything else in this
 * package talks to this class, so swapping the driver touches one file.
 */
export class Connection {
  private readonly raw: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private transactionDepth = 0;
  private closed = false;

  constructor(readonly path: string) {
    this.raw = new DatabaseSync(path);
    // WAL keeps readers unblocked; FULL sync means a committed edit survives
    // power loss, which matters more here than write throughput.
    this.raw.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);
  }

  private statement(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.raw.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  run(sql: string, params: SqlParams = {}): number {
    return Number(this.statement(sql).run(params).changes);
  }

  get(sql: string, params: SqlParams = {}): Row | undefined {
    return this.statement(sql).get(params) as Row | undefined;
  }

  all(sql: string, params: SqlParams = {}): Row[] {
    return this.statement(sql).all(params) as Row[];
  }

  /** Runs `work` atomically. Nested calls join the outer transaction. */
  transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) return work();
    this.raw.exec("BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try {
      const result = work();
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.statements.clear();
    this.raw.close();
  }
}

/** Builds the SET clause for a partial update from a camelCase -> column map. */
export function buildAssignments(
  columns: Readonly<Record<string, string>>,
  patch: Readonly<Record<string, unknown>>,
): { assignments: string[]; params: SqlParams } {
  const assignments: string[] = [];
  const params: SqlParams = {};
  for (const [key, column] of Object.entries(columns)) {
    const value = patch[key];
    if (value === undefined) continue;
    assignments.push(`${column} = :${column}`);
    params[column] = value as SqlValue;
  }
  return { assignments, params };
}
