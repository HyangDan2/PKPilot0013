import { t, type Lang } from '../i18n';
import type { Lesson } from '../lessons/types';
import { panelLabel } from './PanelSlots';
import { IconArrow, IconBook, IconGit, IconPython } from './Icons';

interface LandingProps {
  lang: Lang;
  lessons: Lesson[];
  onOpen: (id: string) => void;
}

const runtimeIcon = (runtime: Lesson['runtime']) => (runtime === 'git' ? IconGit : IconPython);

/** The catalog the learner lands on: every bundled lesson as one card. */
export function Landing({ lang, lessons, onOpen }: LandingProps) {
  return (
    <main className="landing" data-testid="landing">
      <div className="landing-inner">
        <section className="hero">
          <p className="hero-eyebrow">
            <span className="hero-dot" aria-hidden />
            {t(lang, 'landEyebrow')}
          </p>
          <h1 className="hero-title">{t(lang, 'landTitle')}</h1>
          <p className="hero-lead">{t(lang, 'landLead')}</p>
          <ul className="hero-stats">
            <li>
              <b>{lessons.length}</b>
              <span>{t(lang, 'landStatLessons')}</span>
            </li>
            <li>
              <b>3</b>
              <span>{t(lang, 'landStatPanels')}</span>
            </li>
            <li>
              <b>100%</b>
              <span>{t(lang, 'landStatRuntime')}</span>
            </li>
          </ul>
        </section>

        <section className="catalog" aria-label={t(lang, 'navHome')}>
          <div className="catalog-head">
            <h2>
              <IconBook size={15} />
              {t(lang, 'navHome')}
            </h2>
            <span className="catalog-hint">{t(lang, 'landCtaHint')}</span>
          </div>

          {lessons.length === 0 ? (
            <p className="catalog-empty">{t(lang, 'emptyCatalog')}</p>
          ) : (
            <ul className="lesson-grid">
              {lessons.map((lesson) => {
                const Icon = runtimeIcon(lesson.runtime);
                return (
                  <li key={lesson.id}>
                    <button
                      type="button"
                      className="lesson-card"
                      onClick={() => onOpen(lesson.id)}
                      data-testid={`lesson-card-${lesson.id}`}
                      aria-label={`${lesson.title[lang]} — ${t(lang, 'lessonCardCta')}`}
                    >
                      <span className="card-top">
                        <span className={`card-runtime runtime-${lesson.runtime}`}>
                          <Icon size={14} />
                          {lesson.runtime === 'git' ? t(lang, 'runtimeGit') : t(lang, 'runtimePython')}
                        </span>
                        <span className="card-level">{lesson.level[lang]}</span>
                      </span>
                      <span className="card-title">{lesson.title[lang]}</span>
                      <span className="card-sub">{lesson.subtitle[lang]}</span>
                      <span className="card-meta">
                        <span>
                          {t(lang, 'missions')} {lesson.missions.length}
                        </span>
                        <span className="card-dot" aria-hidden />
                        <span>
                          {t(lang, 'filesTab')} {Object.keys(lesson.files).length}
                        </span>
                        <span className="card-dot" aria-hidden />
                        <span>{lesson.panels.map((panel) => panelLabel(lang, panel)).join(' · ')}</span>
                      </span>
                      <span className="card-foot">
                        <span className="card-cta">
                          {t(lang, 'lessonCardCta')}
                          <IconArrow size={14} />
                        </span>
                        <span className="card-file">{lesson.entry}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="land-note">{t(lang, 'landFootNote')}</p>
      </div>
    </main>
  );
}
