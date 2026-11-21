import { t, type Lang } from '../i18n';
import type { LessonMission } from '../lessons/types';
import { IconBulb, IconCheck, IconReset, IconSpark } from './Icons';

interface MissionCardProps {
  lang: Lang;
  mission: LessonMission | null;
  index: number;
  total: number;
  done: number;
  free: boolean;
  hintOpen: boolean;
  onHint: () => void;
  onReset: () => void;
  onResume: () => void;
}

export function MissionCard({ lang, mission, index, total, done, free, hintOpen, onHint, onReset, onResume }: MissionCardProps) {
  const allDone = done >= total && total > 0;

  return (
    <div className="mission-card" data-testid="mission-card">
      <div className="mission-card-head">
        <span>{free ? t(lang, 'freeSandbox') : t(lang, 'missionCurrent')}</span>
        <span className="mission-counter">
          {done}/{total}
        </span>
      </div>

      {mission ? (
        <>
          <div className="mission-card-title">
            <span className="mission-badge">{String(index + 1).padStart(2, '0')}</span>
            <h2>{mission.title[lang]}</h2>
          </div>
          <p className="mission-goal">{mission.goal[lang]}</p>
          <div className="mission-actions">
            <button type="button" className={`hint-btn${hintOpen ? ' on' : ''}`} onClick={onHint} aria-expanded={hintOpen}>
              <IconBulb size={14} />
              {hintOpen ? t(lang, 'missionHintHide') : t(lang, 'missionHint')}
            </button>
            <button type="button" className="ghost-btn" onClick={onReset} title={t(lang, 'missionReset')}>
              <IconReset size={14} />
              {t(lang, 'missionReset')}
            </button>
          </div>
          {hintOpen && <p className="mission-hint">{mission.hint[lang]}</p>}
        </>
      ) : (
        <div className="mission-free">
          <p className="mission-goal">{t(lang, 'freeSandboxBody')}</p>
          {allDone && (
            <p className="mission-done-line">
              <IconCheck size={15} />
              {t(lang, 'missionComplete')}
            </p>
          )}
          <div className="mission-actions">
            <button type="button" className="hint-btn" onClick={onResume}>
              <IconSpark size={14} />
              {t(lang, 'missionAll')}
            </button>
            <button type="button" className="ghost-btn" onClick={onReset}>
              <IconReset size={14} />
              {t(lang, 'missionReset')}
            </button>
          </div>
        </div>
      )}

      <div className="mission-dots" aria-hidden>
        {Array.from({ length: total }, (_, dot) => (
          <span key={dot} className={dot < done ? 'done' : dot === index ? 'current' : ''} />
        ))}
      </div>
    </div>
  );
}
