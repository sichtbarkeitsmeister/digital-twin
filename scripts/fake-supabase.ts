/**
 * An in-memory stand-in for the Supabase client in the test scripts: just the PostgREST builder
 * calls the content code and the job loop make (select, insert, upsert, update, delete, the
 * filters, order, maybeSingle; `update(...).select()` answers with the changed rows). Not a
 * test itself. Used by test-content-skip-steps.ts and test-content-job-ownership.ts.
 */

export type FakeRow = Record<string, unknown>;

type FakeResult = { data: unknown; error: null };

/** Thenable like a PostgREST builder: awaiting it runs the query on the in-memory tables. */
class FakeQuery {
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private payload: FakeRow | FakeRow[] | null = null;
  private conflict: string[] = [];
  private filters: Array<(row: FakeRow) => boolean> = [];
  private mode: "many" | "maybe" | "single" = "many";
  private orderBy: { column: string; ascending: boolean } | null = null;
  private returning = false;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(): this {
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(payload: FakeRow | FakeRow[]): this {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  upsert(payload: FakeRow | FakeRow[], options: { onConflict?: string } = {}): this {
    this.op = "upsert";
    this.payload = payload;
    this.conflict = (options.onConflict ?? "id").split(",").map((c) => c.trim());
    return this;
  }
  update(payload: FakeRow): this {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  gte(column: string, value: number): this {
    this.filters.push((row) => Number(row[column]) >= value);
    return this;
  }
  is(column: string, value: unknown): this {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  not(column: string, _op: string, value: unknown): this {
    this.filters.push((row) => (row[column] ?? null) !== value);
    return this;
  }
  or(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}): this {
    this.orderBy = { column, ascending: options.ascending !== false };
    return this;
  }
  maybeSingle(): this {
    this.mode = "maybe";
    return this;
  }
  single(): this {
    this.mode = "single";
    return this;
  }
  then<A = FakeResult, B = never>(
    resolve?: ((value: FakeResult) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return Promise.resolve(this.run()).then(resolve, reject);
  }

  private run(): FakeResult {
    const rows = this.db.rows(this.table);
    const matches = rows.filter((row) => this.filters.every((f) => f(row)));
    this.db.log.push({ table: this.table, op: this.op, payload: this.payload });
    switch (this.op) {
      case "insert": {
        for (const row of [this.payload].flat() as FakeRow[]) rows.push({ ...row });
        return { data: null, error: null };
      }
      case "upsert": {
        for (const row of [this.payload].flat() as FakeRow[]) {
          const existing = rows.find((r) => this.conflict.every((c) => r[c] === row[c]));
          if (existing) Object.assign(existing, row);
          else rows.push({ ...row });
        }
        return { data: null, error: null };
      }
      case "update":
        for (const row of matches) Object.assign(row, this.payload);
        return { data: this.returning ? matches.map((row) => structuredClone(row)) : null, error: null };
      case "delete":
        this.db.tables[this.table] = rows.filter((row) => !matches.includes(row));
        return { data: null, error: null };
      default: {
        const sorted = [...matches].map((row) => structuredClone(row));
        if (this.orderBy) {
          const { column, ascending } = this.orderBy;
          sorted.sort((a, b) => (Number(a[column]) - Number(b[column])) * (ascending ? 1 : -1));
        }
        if (this.mode === "many") return { data: sorted, error: null };
        return { data: sorted[0] ?? null, error: null };
      }
    }
  }
}

export class FakeDb {
  tables: Record<string, FakeRow[]> = {};
  log: Array<{ table: string; op: string; payload: unknown }> = [];
  constructor(init: Record<string, FakeRow[]> = {}) {
    for (const [table, rows] of Object.entries(init)) this.tables[table] = rows.map((r) => structuredClone(r));
  }
  rows(table: string): FakeRow[] {
    return (this.tables[table] ??= []);
  }
  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }
  /** The fake where code expects a `SupabaseClient`. */
  get service(): never {
    return this as never;
  }
}
