// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { SqlSandbox, isSqlError, type SqlResult } from '../src/tracks/sql/db';
import { sqlMissions, type SqlMissionState } from '../src/tracks/missions';

let sandbox: SqlSandbox;

const run = (sql: string): SqlResult => {
  const result = sandbox.run(sql);
  if (isSqlError(result)) throw new Error(result.message);
  return result;
};

beforeAll(async () => {
  const module = (await import('sql.js')) as unknown as { default?: unknown };
  const init = (module.default ?? module) as (options: { locateFile: (file: string) => string }) => Promise<unknown>;
  const SQL = await init({
    locateFile: (file: string) => new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url).pathname,
  });
  sandbox = new SqlSandbox(async () => SQL as { Database: new () => never });
  await sandbox.init();
});

describe('sqlite sandbox', () => {
  it('ships the sample schema and rows', () => {
    const tables = sandbox.tables();
    expect(tables.map((table) => table.name)).toEqual(['departments', 'employees', 'sales']);
    expect(tables.find((table) => table.name === 'employees')?.rows).toBe(8);
    expect(tables.find((table) => table.name === 'employees')?.columns.map((column) => column.name)).toContain('salary');
    expect(tables.find((table) => table.name === 'departments')?.columns[0].pk).toBe(true);
  });

  it('selects every employee', () => {
    const result = run('SELECT * FROM employees ORDER BY id;');
    expect(result.columns).toContain('name');
    expect(result.rows).toHaveLength(8);
    expect(result.rows[0][1]).toBe('김하늘');
  });

  it('filters with WHERE', () => {
    const result = run('SELECT name, salary FROM employees WHERE salary >= 5000;');
    expect(result.rows).toHaveLength(3);
    expect(result.rows.every((row) => Number(row[1]) >= 5000)).toBe(true);
  });

  it('sorts and limits', () => {
    const result = run('SELECT name, salary FROM employees ORDER BY salary DESC LIMIT 3;');
    expect(result.rows.map((row) => row[1])).toEqual([6200, 5600, 5100]);
  });

  it('joins and groups by department', () => {
    const result = run(`
      SELECT d.name AS name, ROUND(AVG(e.salary)) AS avg_salary
      FROM employees e JOIN departments d ON d.id = e.dept_id
      GROUP BY d.id, d.name ORDER BY d.id;
    `);
    expect(result.columns).toEqual(['name', 'avg_salary']);
    expect(result.rows).toHaveLength(4);
  });

  it('inserts a row and reports the change count', () => {
    const before = sandbox.tables().find((table) => table.name === 'employees')?.rows ?? 0;
    const result = run("INSERT INTO employees (name, dept_id, salary, hired_at) VALUES ('한지민', 3, 4700, '2026-11-21');");
    expect(result.changes).toBe(1);
    const after = sandbox.tables().find((table) => table.name === 'employees')?.rows ?? 0;
    expect(after).toBe(before + 1);
  });

  it('reports syntax errors without breaking the database', () => {
    const result = sandbox.run('SELEC * FROM employees;');
    expect(isSqlError(result)).toBe(true);
    if (isSqlError(result)) expect(result.message).toContain('syntax error');
    expect(run('SELECT COUNT(*) FROM employees;').rows[0][0]).toBeGreaterThan(0);
  });

  it('answers dot commands in the terminal', () => {
    const dot = sandbox.exec('.tables');
    expect(dot.lines[0].text).toContain('employees');
    const schema = sandbox.exec('.schema employees');
    expect(schema.lines.map((line) => line.text).join('\n')).toContain('CREATE TABLE employees');
    const select = sandbox.exec('SELECT name FROM employees LIMIT 1;');
    expect(select.lines[0].text).toBe('name');
  });
});

describe('sql missions', () => {
  const state = (result: SqlResult): SqlMissionState => ({
    tables: sandbox.tables(),
    last: result,
    lastSql: 'SELECT ...',
  });

  it('passes the select, where, order and group missions', () => {
    const all = run('SELECT * FROM employees;');
    expect(sqlMissions[0].check(state(all))).toBe(true);
    expect(sqlMissions[0].check({ tables: [], last: null, lastSql: '' })).toBe(false);

    const where = run('SELECT name, salary FROM employees WHERE salary >= 5000;');
    expect(sqlMissions[1].check(state(where))).toBe(true);

    const order = run('SELECT name, salary FROM employees ORDER BY salary DESC LIMIT 3;');
    expect(sqlMissions[2].check(state(order))).toBe(true);
    expect(sqlMissions[2].check(state(all))).toBe(false);

    const group = run(`
      SELECT d.name, AVG(e.salary) AS avg_salary FROM employees e
      JOIN departments d ON d.id = e.dept_id GROUP BY d.id, d.name;
    `);
    expect(sqlMissions[3].check(state(group))).toBe(true);

    expect(sqlMissions[4].check({ tables: sandbox.tables(), last: null, lastSql: '' })).toBe(true);
  });
});
