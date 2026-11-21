import { useEffect, useState } from 'react';
import { t, type Lang } from './i18n';
import { useSandbox } from './state/useSandbox';
import { TRACKS } from './tracks';
import { pythonStatus } from './tracks/python/runner';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { Terminal } from './components/Terminal';
import { MissionCard } from './components/MissionCard';
import { GitGraph, GitStatus } from './components/GitPanels';
import { DirTree, PythonOutput, SchemaView, SqlResultTable } from './components/Visualizers';
import { IconCheck } from './components/Icons';

type MobileTab = 'files' | 'editor' | 'terminal' | 'output';

const LANG_KEY = 'visna-sol:lang';
const THEME_KEY = 'visna-sol:theme';

const readLang = (): Lang => {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ko';
  } catch {
    return 'ko';
  }
};

const readTheme = (): 'dark' | 'light' => {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};

export default function App() {
  const [lang, setLang] = useState<Lang>(readLang);
  const [theme, setTheme] = useState<'dark' | 'light'>(readTheme);
  const [mobileTab, setMobileTab] = useState<MobileTab>('editor');
  const sandbox = useSandbox(lang);
  const { track, session, activeMission, missions } = sandbox;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0B1020' : '#FAFAFD');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme, lang]);

  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  const missionIndex = session.missionIndex >= missions.length ? missions.length : session.missionIndex;
  const free = session.free || session.missionIndex >= missions.length;
  const lineCount = (session.files[session.active] ?? '').split('\n').length;
  const pyState = pythonStatus();
  const runtimeLabel =
    track === 'python'
      ? pyState.stage === 'ready'
        ? 'CPython 3.13'
        : t(lang, 'statusNotLoaded')
      : track === 'sql'
        ? session.sqlTables.length
          ? t(lang, 'statusSqlite')
          : t(lang, 'statusNotLoaded')
        : '';

  return (
    <div className="app" data-track={track}>
      <TopBar
        lang={lang}
        onLang={setLang}
        theme={theme}
        onTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        track={track}
        onTrack={(id) => {
          sandbox.setTrack(id);
          setMobileTab('editor');
        }}
        onResetFiles={sandbox.resetFiles}
        onClearTerminal={sandbox.clearTerminal}
      />

      <div className={`mission-banner${mobileTab === 'output' ? ' hide-for-output' : ''}`} data-testid="mission-banner">
        {activeMission ? (
          <>
            <span className="banner-index">{String(missionIndex + 1).padStart(2, '0')}</span>
            <span className="banner-title">{activeMission.title[lang]}</span>
            <span className="banner-count">
              {sandbox.completed.length}/{missions.length}
            </span>
          </>
        ) : (
          <>
            <span className="banner-index">✦</span>
            <span className="banner-title">{t(lang, 'freeSandbox')}</span>
            <span className="banner-count">
              {sandbox.completed.length}/{missions.length}
            </span>
          </>
        )}
      </div>

      <div className={`workspace tab-${mobileTab}`}>
        <Sidebar
          lang={lang}
          files={session.files}
          active={session.active}
          missions={missions}
          done={sandbox.completed}
          missionIndex={missionIndex}
          free={free}
          onOpen={(path) => {
            sandbox.openFile(path);
            setMobileTab('editor');
          }}
          onCreate={sandbox.createFile}
          onDelete={sandbox.deleteFile}
          onResetFiles={sandbox.resetFiles}
          onSelectMission={(index) => {
            sandbox.selectMission(index);
            setMobileTab(index >= missions.length ? 'terminal' : 'output');
          }}
        />

        <section className="center">
          <Editor
            lang={lang}
            track={track}
            files={session.files}
            active={session.active}
            running={sandbox.running}
            onChange={(value) => sandbox.setFile(session.active, value)}
            onOpen={sandbox.openFile}
            onRun={sandbox.runActive}
          />
          <Terminal
            lang={lang}
            prompt={TRACKS[track].prompt}
            entries={session.term}
            history={session.history}
            chips={TRACKS[track].chips}
            running={sandbox.running}
            onCommand={sandbox.submit}
            onClear={sandbox.clearTerminal}
            onComplete={sandbox.complete}
          />
        </section>

        <aside className="right" data-testid="right-panel">
          <MissionCard
            lang={lang}
            mission={activeMission}
            index={missionIndex}
            total={missions.length}
            done={sandbox.completed.length}
            free={free}
            hintOpen={session.hintOpen}
            onHint={sandbox.toggleHint}
            onReset={sandbox.resetTrack}
            onResume={() => sandbox.selectMission(Math.min(missions.length - 1, sandbox.completed.length))}
          />
          {track === 'git' && (
            <>
              <GitGraph lang={lang} snap={session.gitSnap} />
              <GitStatus lang={lang} snap={session.gitSnap} />
            </>
          )}
          {track === 'python' && (
            <PythonOutput lang={lang} run={session.lastRun} progress={sandbox.pyProgress} running={sandbox.running} />
          )}
          {track === 'linux' && (
            <DirTree lang={lang} tree={session.linuxSnap?.tree ?? []} cwd={session.linuxSnap?.cwd ?? '/home/learner/work'} />
          )}
          {track === 'sql' && (
            <>
              <SqlResultTable lang={lang} result={session.sqlLast} />
              <SchemaView lang={lang} tables={session.sqlTables} />
            </>
          )}
        </aside>
      </div>

      <nav className="mobile-tabs" role="tablist" aria-label="Panels">
        {(['files', 'editor', 'terminal', 'output'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={mobileTab === tab}
            className={mobileTab === tab ? 'on' : ''}
            onClick={() => setMobileTab(tab)}
            data-testid={`mtab-${tab}`}
          >
            {t(
              lang,
              tab === 'files'
                ? 'mobileFiles'
                : tab === 'editor'
                  ? 'mobileEditor'
                  : tab === 'terminal'
                    ? 'mobileTerminal'
                    : 'mobileOutput',
            )}
          </button>
        ))}
      </nav>

      <footer className="statusbar">
        <span className="status-item">
          <span className="status-key">{t(lang, 'statusTrack')}</span>
          {t(lang, track === 'git' ? 'trackGit' : track === 'python' ? 'trackPython' : track === 'linux' ? 'trackLinux' : 'trackSql')}
        </span>
        <span className="status-item">
          <span className="status-key">{session.active}</span>
          {lineCount} {t(lang, 'lines')}
        </span>
        <span className="status-right">
          {sandbox.completed.length > 0 && (
            <span className="status-item ok">
              <IconCheck size={12} />
              {sandbox.completed.length}/{missions.length}
            </span>
          )}
          {runtimeLabel && <span className="status-item">{runtimeLabel}</span>}
          <span className="status-item">{t(lang, 'statusLocal')}</span>
        </span>
      </footer>

      {sandbox.toast && (
        <div className="toast" role="status" data-testid="toast">
          <IconCheck size={15} />
          <span>
            {sandbox.toast.ids ? (
              <>
                {t(lang, 'missionDoneToast')} ·{' '}
                <b>
                  {sandbox.toast.ids
                    .map((id) => missions.find((mission) => mission.id === id)?.title[lang])
                    .filter(Boolean)
                    .join(' · ')}
                </b>
              </>
            ) : (
              <b>{sandbox.toast.text}</b>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
