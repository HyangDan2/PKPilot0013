/**
 * SQLite in the browser through sql.js. The wasm binary is served from our own
 * origin (`public/sqljs/`), so the SQL track works offline once the app loads.
 */
import { type CommandResult, type OutLine, blank, fail, mix, out, result } from '../types';

export interface SqlColumn {
  name: string;
  type: string;
  pk: boolean;
}

export interface SqlTable {
  name: string;
  columns: SqlColumn[];
  rows: number;
}

export interface SqlResult {
  columns: string[];
  rows: (string | number | null)[][];
  ms: number;
  changes: number;
  statements: number;
}

export interface SqlError {
  message: string;
  ms: number;
}

export type SqlRun = SqlResult | SqlError;

export const isSqlError = (run: SqlRun): run is SqlError => 'message' in run && !('columns' in run);

type Database = {
  exec: (sql: string) => { columns: string[]; values: (string | number | null)[][] }[];
  run: (sql: string) => void;
  getRowsModified: () => number;
  close: () => void;
};

export type SqlFactory = (options: { locateFile: (file: string) => string }) => Promise<{
  Database: new () => Database;
}>;

const SEED = `
CREATE TABLE departments (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE employees (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  dept_id  INTEGER REFERENCES departments(id),
  salary   INTEGER NOT NULL,
  hired_at TEXT NOT NULL
);

CREATE TABLE sales (
  id          INTEGER PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  amount      INTEGER NOT NULL,
  sold_at     TEXT NOT NULL
);

INSERT INTO departments (id, name) VALUES
  (1, '제품'),
  (2, '디자인'),
  (3, '개발'),
  (4, '운영');

INSERT INTO employees (id, name, dept_id, salary, hired_at) VALUES
  (1, '김하늘', 3, 6200, '2019-03-04'),
  (2, '이도윤', 1, 4800, '2020-07-13'),
  (3, '박서연', 2, 5100, '2018-11-01'),
  (4, '최민준', 3, 5600, '2021-01-18'),
  (5, '정지우', 4, 3900, '2022-05-09'),
  (6, '강유나', 2, 4300, '2023-02-20'),
  (7, '윤태호', 3, 3300, '2024-08-12'),
  (8, '임소라', 1, 4500, '2022-10-24');

INSERT INTO sales (employee_id, amount, sold_at) VALUES
  (2, 1200000, '2026-09-02'), (2, 860000, '2026-09-18'), (3, 2400000, '2026-09-21'),
  (1, 3100000, '2026-10-01'), (4, 1500000, '2026-10-06'), (5, 640000, '2026-10-11'),
  (6, 980000, '2026-10-19'), (1, 2750000, '2026-11-03'), (2, 1330000, '2026-11-12'),
  (7, 420000, '2026-11-15');
`;

/** Tables a learner can inspect in the schema panel. */
export class SqlSandbox {
  private db: Database | null = null;
  private factory: SqlFactory;
  ready = false;

  constructor(factory: SqlFactory) {
    this.factory = factory;
  }

  async init(): Promise<void> {
    if (this.ready) return;
    const SQL = await this.factory({
      locateFile: (file) => `${import.meta.env.BASE_URL ?? '/'}sqljs/${file}`,
    });
    this.db = new SQL.Database();
    this.db.run(SEED);
    this.ready = true;
  }

  reset(): void {
    if (!this.db) return;
    this.db.close();
    this.db = null;
    this.ready = false;
  }

  private require(): Database {
    if (!this.db) throw new Error('SQLite is not ready');
    return this.db;
  }

  run(sql: string): SqlRun {
    const started = performance.now();
    const text = sql.trim();
    if (!text) return { columns: [], rows: [], ms: 0, changes: 0, statements: 0 };
    try {
      const db = this.require();
      const results = db.exec(text);
      const ms = Math.round((performance.now() - started) * 10) / 10;
      const changes = db.getRowsModified();
      const last = results[results.length - 1];
      return {
        columns: last?.columns ?? [],
        rows: last?.values ?? [],
        ms,
        changes,
        statements: results.length,
      };
    } catch (thrown) {
      const ms = Math.round((performance.now() - started) * 10) / 10;
      return { message: thrown instanceof Error ? thrown.message : String(thrown), ms };
    }
  }

  tables(): SqlTable[] {
    const db = this.require();
    const names = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const list = names[0]?.values.map((row) => String(row[0])) ?? [];
    return list.map((name) => {
      const info = db.exec(`PRAGMA table_info("${name}")`);
      const columns: SqlColumn[] = (info[0]?.values ?? []).map((row) => ({
        name: String(row[1]),
        type: String(row[2] || 'ANY'),
        pk: Number(row[5]) > 0,
      }));
      const count = db.exec(`SELECT COUNT(*) FROM "${name}"`);
      return { name, columns, rows: Number(count[0]?.values[0]?.[0] ?? 0) };
    });
  }

  /** Terminal: SQL statements plus the dot commands a learner expects. */
  exec(input: string): CommandResult {
    const text = input.trim();
    if (!text) return result([]);
    if (text.startsWith('.')) {
      const [cmd, ...rest] = text.split(/\s+/);
      switch (cmd) {
        case '.tables':
          return result([out(this.tables().map((table) => table.name).join('  '), 'accent')]);
        case '.schema': {
          const target = rest[0];
          const tables = this.tables().filter((table) => !target || table.name === target);
          if (!tables.length) return fail([out(`no such table: ${target}`, 'err')]);
          const lines: OutLine[] = [];
          for (const table of tables) {
            lines.push(out(`CREATE TABLE ${table.name} (`, 'accent'));
            table.columns.forEach((column, index) => {
              lines.push(
                out(
                  `  ${column.name} ${column.type}${column.pk ? ' PRIMARY KEY' : ''}${index === table.columns.length - 1 ? '' : ','}`,
                  'plain',
                ),
              );
            });
            lines.push(out(');', 'accent'));
          }
          return result(lines);
        }
        case '.help':
          return result([
            out('Vísna Sól SQL 터미널', 'accent'),
            out('  SQL 문장을 그대로 입력하면 실행합니다.', 'dim'),
            out('  .tables   테이블 목록을 보여 줍니다', 'dim'),
            out('  .schema [테이블]  테이블 구조를 보여 줍니다', 'dim'),
            out('  .clear    터미널을 지웁니다', 'dim'),
            blank(),
            out('  예) SELECT name, salary FROM employees ORDER BY salary DESC LIMIT 3;', 'dim'),
          ]);
        case '.clear':
          return { lines: [], exit: 0, clear: true };
        default:
          return fail([out(`Error: unknown command "${cmd}"`, 'err')]);
      }
    }
    const run = this.run(text);
    if (isSqlError(run)) {
      return fail([out(`Error: ${run.message}`, 'err')]);
    }
    const lines: OutLine[] = [];
    if (run.columns.length) {
      lines.push(mix({ text: run.columns.join(' | '), tone: 'accent' }));
      lines.push(out('-'.repeat(Math.min(60, run.columns.join(' | ').length)), 'dim'));
      for (const row of run.rows.slice(0, 20)) {
        lines.push(out(row.map((cell) => (cell === null ? 'NULL' : String(cell))).join(' | ')));
      }
      if (run.rows.length > 20) lines.push(out(`… ${run.rows.length - 20}행 더 있습니다`, 'dim'));
      lines.push(out(`${run.rows.length}행 · ${run.ms}ms`, 'dim'));
    } else {
      lines.push(out(`OK (${run.changes}행 변경 · ${run.ms}ms)`, 'ok'));
    }
    return result(lines);
  }
}

/** Node-friendly factory used by the unit tests and the browser alike. */
export async function defaultSqlFactory(options: { locateFile: (file: string) => string }) {
  const module = (await import('sql.js')) as unknown as { default?: SqlFactory };
  const init = module.default ?? (module as unknown as SqlFactory);
  return init(options) as Promise<{ Database: new () => Database }>;
}

export const sqlSeed = (): Record<string, string> => ({
  'query.sql': [
    '-- Vísna Sól · SQLite 실습',
    '-- Ctrl+Enter 또는 실행 버튼으로 이 쿼리를 실행합니다.',
    '',
    'SELECT id, name, salary',
    'FROM employees',
    'ORDER BY salary DESC;',
  ].join('\n'),
  'README.sql': [
    '-- 테이블',
    '--   departments (부서)',
    '--   employees   (직원: 부서, 연봉, 입사일)',
    '--   sales       (매출: 직원, 금액, 판매일)',
    '',
    '-- 팁: 터미널에서 .schema 를 입력하면 전체 구조를 볼 수 있습니다.',
  ].join('\n'),
});
