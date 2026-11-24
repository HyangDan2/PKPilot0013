import { useState } from 'react';
import { t, type Lang } from '../i18n';
import { RUNTIMES } from '../tracks';
import { pythonStatus } from '../tracks/python/runner';
import { useSandbox } from '../state/useSandbox';
import type { Lesson } from '../lessons/types';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { Editor } from './Editor';
import { Terminal } from './Terminal';
import { MissionCard } from './MissionCard';
import { DEFAULT_PANELS, PanelSlots } from './PanelSlots';
import { IconCheck } from './Icons';

type MobileTab = 'files' | 'editor' | 'terminal' | 'output';

interface LessonWorkspaceProps {
  lesson: Lesson;
  lang: Lang;
  theme: 'dark' | 'light';
  onLang: (lang: Lang) => void;
  onTheme: () => void;
  onHome: () => void;
}

/**
 * One IDE shell for every lesson. What changes between lessons is data: the
 * files and missions from the markdown, the runtime's terminal, and the panel
 * slots the right column assembles.
 */
export function LessonWorkspace({ lesson, lang, theme, onLang, onTheme, onHome }: LessonWorkspaceProps) {
  const sandbox = useSandbox(lesson, lang);
  const [mobileTab, setMobileTab] = useState<MobileTab>('editor');
  const { session } = sandbox;
  const missions = lesson.missions;
  const config = RUNTIMES[lesson.runtime];
  const free = session.free || session.missionIndex >= missions.length;
  const missionIndex = free ? missions.length : session.missionIndex;
  const lineCount = (session.files[session.active] ?? '').split('\n').length;
  const pyState = pythonStatus();
  const runtimeLabel =
    lesson.runtime === 'python'
      ? pyState.stage === 'ready'
        ? t(lang, 'statusPython')
        : t(lang, 'statusNotLoaded')
      : 'Git';

  return (
    <div className="app" data-runtime={lesson.runtime} data-lesson={lesson.id}>
      <TopBar
        lang={lang}
        onLang={onLang}
        theme={theme}
        onTheme={onTheme}
        onHome={onHome}
        onResetFiles={sandbox.resetFiles}
        onClearTerminal={sandbox.clearTerminal}
      />

      <div className={`mission-banner${mobileTab === 'output' ? ' hide-for-output' : ''}`} data-testid="mission-banner">
        {sandbox.activeMission ? (
          <>
            <span className="banner-index">{String(missionIndex + 1).padStart(2, '0')}</span>
            <span className="banner-title">{sandbox.activeMission.title[lang]}</span>
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

      {sandbox.syncConflict && (
        <div className="sync-banner" role="alert" data-testid="sync-conflict">
          <div className="sync-text">
            <b>{t(lang, 'syncConflictTitle')}</b>
            <span>{t(lang, 'syncConflictBody')}</span>
          </div>
          <div className="sync-actions">
            <button type="button" data-testid="sync-keep-mine" onClick={() => sandbox.resolveSync('mine')}>
              {t(lang, 'syncKeepMine')}
            </button>
            <button type="button" data-testid="sync-load-theirs" onClick={() => sandbox.resolveSync('theirs')}>
              {t(lang, 'syncLoadTheirs')}
            </button>
          </div>
        </div>
      )}

      <div className={`workspace tab-${mobileTab}`}>        <Sidebar
          lang={lang}
          lesson={lesson}
          files={session.files}
          active={session.active}
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
            runtime={lesson.runtime}
            files={session.files}
            active={session.active}
            running={sandbox.running}
            onChange={(value) => sandbox.setFile(session.active, value)}
            onOpen={sandbox.openFile}
            onRun={sandbox.runActive}
            onStop={sandbox.stopRun}
          />
          <Terminal
            lang={lang}
            prompt={config.prompt}
            entries={session.term}
            history={session.history}
            chips={config.chips}
            running={sandbox.running}
            onCommand={sandbox.submit}
            onClear={sandbox.clearTerminal}
            onComplete={sandbox.complete}
          />
        </section>

        <aside className="right" data-testid="right-panel">
          <MissionCard
            lang={lang}
            mission={sandbox.activeMission}
            index={missionIndex}
            total={missions.length}
            done={sandbox.completed.length}
            free={free}
            hintOpen={session.hintOpen}
            onHint={sandbox.toggleHint}
            onReset={sandbox.resetLesson}
            onResume={() => sandbox.selectMission(Math.min(missions.length - 1, sandbox.completed.length))}
          />
          <PanelSlots
            lang={lang}
            declared={lesson.panels}
            fallback={DEFAULT_PANELS[lesson.runtime]}
            gitSnap={session.gitSnap}
            run={session.lastRun}
            progress={sandbox.pyProgress}
            running={sandbox.running}
            staleRun={sandbox.staleRun}
            completion={
              sandbox.completion
                ? { settings: sandbox.completion, onChange: sandbox.setCompletion }
                : null
            }
          />
        </aside>
      </div>

      <nav className="mobile-tabs" role="tablist" aria-label={t(lang, 'editorTitle')}>
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
          <span className="status-key">{t(lang, 'statusLesson')}</span>
          {lesson.title[lang]}
        </span>
        <span className="status-item">
          <span className="status-key">{session.active || '—'}</span>
          {lineCount} {t(lang, 'lines')}
        </span>
        <span className="status-right">
          {sandbox.completed.length > 0 && (
            <span className="status-item ok">
              <IconCheck size={12} />
              {sandbox.completed.length}/{missions.length}
            </span>
          )}
          <span className="status-item">{runtimeLabel}</span>
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
