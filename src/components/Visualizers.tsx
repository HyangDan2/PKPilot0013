import { t, type Lang } from '../i18n';
import type { PythonProgress } from '../tracks/python/runner';
import type { RunOutput } from '../state/useSandbox';

/** The `output` slot: the last run's stdout, stderr and timing. */
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
    <div className="viz-card" data-testid="output-card">
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
