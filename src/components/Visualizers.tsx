import { t, type Lang } from '../i18n';
import type { TreeEntry } from '../tracks/linux/shell';
import type { SqlResult, SqlTable } from '../tracks/sql/db';
import type { PythonProgress } from '../tracks/python/runner';
import type { RunOutput } from '../state/useSandbox';
import { IconFolder } from './Icons';

/** Linux track: the file system the shell is actually walking. */
export function DirTree({ lang, tree, cwd }: { lang: Lang; tree: TreeEntry[]; cwd: string }) {
  const render = (entries: TreeEntry[], depth: number) => (
    <ul className="tree">
      {entries.map((entry) => (
        <li key={entry.path}>
          <div
            className={`tree-row${entry.type === 'dir' ? ' dir' : ''}${entry.path === cwd ? ' here' : ''}`}
            style={{ paddingLeft: 6 + depth * 14 }}
          >
            {entry.type === 'dir' ? (
              <IconFolder size={13} />
            ) : (
              <span className="tree-file" aria-hidden>
                ·
              </span>
            )}
            <span className="tree-name">{entry.name}</span>
            {entry.type === 'file' && <span className="tree-size">{entry.size} B</span>}
            {entry.path === cwd && <span className="tree-here">{t(lang, 'cwd')}</span>}
          </div>
          {entry.children && entry.children.length > 0 && render(entry.children, depth + 1)}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="viz-card">
      <div className="viz-head">
        <span>{t(lang, 'dirTree')}</span>
        <span className="viz-meta">{cwd}</span>
      </div>
      {tree.length === 0 ? <p className="viz-empty">—</p> : render(tree, 0)}
    </div>
  );
}

/** Python track: the last run's stdout, stderr and timing. */
export function PythonOutput({
  lang,
  run,
  progress,
  running,
}: {
  lang: Lang;
  run: RunOutput | null;
  progress: PythonProgress;
  running: boolean;
}) {
  const loading = running && (progress.stage === 'script' || progress.stage === 'runtime');
  return (
    <div className="viz-card">
      <div className="viz-head">
        <span>{t(lang, 'outputPython')}</span>
        {run && <span className="viz-meta">{run.ms} ms</span>}
      </div>
      {loading ? (
        <div className="py-load">
          <div className="py-load-head">
            <span>{t(lang, 'pyLoadingTitle')}</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="py-bar" aria-hidden>
            <span style={{ width: `${Math.max(8, progress.percent)}%` }} />
          </div>
          <p className="viz-note">
            {progress.stage === 'script' ? t(lang, 'pyLoadingScript') : t(lang, 'pyLoadingRuntime')}
          </p>
        </div>
      ) : progress.stage === 'error' ? (
        <p className="viz-error">{t(lang, 'pyOffline')}</p>
      ) : run ? (
        <>
          <p className="viz-note">
            {run.path} · {run.ms} ms
          </p>
          {run.stdout && (
            <pre className="out-block" data-testid="py-stdout">
              {run.stdout}
            </pre>
          )}
          {!run.stdout && !run.error && (
            <p className="viz-empty">
              {lang === 'ko' ? '출력이 없습니다. print 문을 넣어 보세요.' : 'No output — try a print statement.'}
            </p>
          )}
          {run.stderr && (
            <pre className="out-block err">
              <span className="out-label">{t(lang, 'outputStderr')}</span>
              {run.stderr}
            </pre>
          )}
          {run.error && (
            <pre className="out-block err" data-testid="py-error">
              <span className="out-label">{t(lang, 'outputErrors')}</span>
              {run.error}
            </pre>
          )}
        </>
      ) : (
        <>
          <p className="viz-empty">{t(lang, 'outputEmpty')}</p>
          <p className="viz-note">{t(lang, 'pyFirstRun')}</p>
        </>
      )}
    </div>
  );
}

/** SQL track: the last result set, scrollable on a phone. */
export function SqlResultTable({ lang, result }: { lang: Lang; result: SqlResult | null }) {
  return (
    <div className="viz-card">
      <div className="viz-head">
        <span>{t(lang, 'sqlResult')}</span>
        {result && (
          <span className="viz-meta">
            {result.rows.length} {t(lang, 'rows')} · {result.ms} {t(lang, 'queryMs')}
          </span>
        )}
      </div>
      {!result || result.columns.length === 0 ? (
        <p className="viz-empty">{t(lang, 'sqlNoResult')}</p>
      ) : (
        <div className="table-wrap">
          <table className="result-table" data-testid="sql-table">
            <thead>
              <tr>
                {result.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell === null ? 'NULL' : String(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SchemaView({ lang, tables }: { lang: Lang; tables: SqlTable[] }) {
  return (
    <div className="viz-card">
      <div className="viz-head">
        <span>{t(lang, 'schema')}</span>
        <span className="viz-meta">{tables.length} tables</span>
      </div>
      {tables.length === 0 ? (
        <p className="viz-empty">{t(lang, 'sqlLoading')}</p>
      ) : (
        <ul className="schema-list">
          {tables.map((table) => (
            <li key={table.name}>
              <div className="schema-table">
                <b>{table.name}</b>
                <span>
                  {table.rows} {t(lang, 'rows')} · {table.columns.length} {t(lang, 'columns')}
                </span>
              </div>
              <ul className="schema-cols">
                {table.columns.map((column) => (
                  <li key={column.name}>
                    <span className="col-name">{column.name}</span>
                    <span className="col-type">{column.type}</span>
                    {column.pk && <span className="col-pk">PK</span>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
