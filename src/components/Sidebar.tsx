import { useEffect, useRef, useState } from 'react';
import { t, type Lang } from '../i18n';
import type { Mission } from '../tracks/types';
import { IconCheck, IconFile, IconPlus, IconReset, IconSpark, IconTrash } from './Icons';

interface SidebarProps {
  lang: Lang;
  files: Record<string, string>;
  active: string;
  missions: Mission<never>[];
  done: string[];
  missionIndex: number;
  free: boolean;
  onOpen: (path: string) => void;
  onCreate: (path: string) => void;
  onDelete: (path: string) => void;
  onSelectMission: (index: number) => void;
  onResetFiles: () => void;
}

export function Sidebar({
  lang,
  files,
  active,
  missions,
  done,
  missionIndex,
  free,
  onOpen,
  onCreate,
  onDelete,
  onSelectMission,
  onResetFiles,
}: SidebarProps) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const names = Object.keys(files).sort();

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const commitCreate = () => {
    const name = draft.trim();
    if (name) onCreate(name);
    setDraft('');
    setCreating(false);
  };

  const progress = missions.length === 0 ? 0 : Math.round((done.length / missions.length) * 100);

  return (
    <aside className="sidebar" data-testid="sidebar">
      <section className="side-block">
        <div className="side-head">
          <span>{t(lang, 'explorer')}</span>
          <span className="side-actions">
            <button
              type="button"
              className="side-action"
              onClick={onResetFiles}
              aria-label={t(lang, 'resetFiles')}
              title={t(lang, 'resetFiles')}
              data-testid="reset-files"
            >
              <IconReset size={13} />
            </button>
            <button
              type="button"
              className="side-action"
              onClick={() => setCreating(true)}
              aria-label={t(lang, 'newFile')}
              title={t(lang, 'newFile')}
              data-testid="new-file"
            >
              <IconPlus size={14} />
            </button>
          </span>
        </div>
        <div className="file-list" role="list" aria-label={t(lang, 'workspaceFiles')}>
          {creating && (
            <div className="file-row editing">
              <IconFile size={13} />
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitCreate();
                  if (event.key === 'Escape') {
                    setCreating(false);
                    setDraft('');
                  }
                }}
                onBlur={commitCreate}
                placeholder="note.md"
                aria-label={t(lang, 'newFile')}
              />
            </div>
          )}
          {names.map((name) => (
            <div key={name} className={`file-row${name === active ? ' on' : ''}`} role="listitem">
              <button type="button" className="file-open" onClick={() => onOpen(name)} data-testid={`file-${name}`}>
                <IconFile size={13} />
                <span className="file-name">{name}</span>
              </button>
              <button
                type="button"
                className="file-del"
                onClick={() => onDelete(name)}
                aria-label={`${t(lang, 'deleteFile')} — ${name}`}
                title={t(lang, 'deleteFile')}
                disabled={names.length <= 1}
              >
                <IconTrash size={13} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="side-block missions-block">
        <div className="side-head">
          <span>{t(lang, 'missions')}</span>
          <span className="side-count">
            {done.length}/{missions.length}
          </span>
        </div>
        <div className="progress-track" aria-hidden>
          <span style={{ width: `${progress}%` }} />
        </div>
        <ol className="mission-list">
          {missions.map((mission, index) => {
            const complete = done.includes(mission.id);
            const current = !free && index === missionIndex;
            return (
              <li key={mission.id}>
                <button
                  type="button"
                  className={`mission-row${current ? ' on' : ''}${complete ? ' done' : ''}`}
                  onClick={() => onSelectMission(index)}
                  data-testid={`mission-${mission.id}`}
                >
                  <span className="mission-num">{complete ? <IconCheck size={12} /> : index + 1}</span>
                  <span className="mission-title">{mission.title[lang]}</span>
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              className={`mission-row free${free ? ' on' : ''}`}
              onClick={() => onSelectMission(missions.length)}
              data-testid="mission-free"
            >
              <span className="mission-num"><IconSpark size={12} /></span>
              <span className="mission-title">{t(lang, 'freeSandbox')}</span>
            </button>
          </li>
        </ol>
      </section>
    </aside>
  );
}
