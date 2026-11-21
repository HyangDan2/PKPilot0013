import { t, trackDesc, type Lang } from '../i18n';
import type { TrackId } from '../tracks/types';
import { TRACK_ORDER } from '../tracks';
import { IconDatabase, IconGit, IconMoon, IconPython, IconSun, IconTerminal } from './Icons';
import { PortalMenu } from './PortalMenu';

interface TopBarProps {
  lang: Lang;
  onLang: (lang: Lang) => void;
  theme: 'dark' | 'light';
  onTheme: () => void;
  track: TrackId;
  onTrack: (id: TrackId) => void;
  onResetFiles: () => void;
  onClearTerminal: () => void;
}

const ICONS: Record<TrackId, (props: { size?: number }) => React.ReactElement> = {
  git: IconGit,
  python: IconPython,
  linux: IconTerminal,
  sql: IconDatabase,
};

const LABEL = (lang: Lang, id: TrackId) =>
  ({
    git: t(lang, 'trackGit'),
    python: t(lang, 'trackPython'),
    linux: t(lang, 'trackLinux'),
    sql: t(lang, 'trackSql'),
  })[id];

export function TopBar({ lang, onLang, theme, onTheme, track, onTrack, onResetFiles, onClearTerminal }: TopBarProps) {
  return (
    <header className="topbar">
      <a className="brand" href="https://hyangdan2.github.io/" target="_blank" rel="noopener noreferrer" title="HD2Lab Web-HQ">
        <span className="mark" aria-hidden />
        <span className="brand-name">HD2Lab</span>
        <span className="brand-pipe" aria-hidden />
        <span className="brand-app">Vísna Sól</span>
      </a>

      <nav className="tracks" role="tablist" aria-label="Tracks">
        {TRACK_ORDER.map((id) => {
          const Icon = ICONS[id];
          const active = id === track;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`track-tab${active ? ' on' : ''}`}
              onClick={() => onTrack(id)}
              data-testid={`track-${id}`}
              title={`${LABEL(lang, id)} — ${trackDesc(lang, id)}`}
            >
              <Icon size={15} />
              <span className="track-label">{LABEL(lang, id)}</span>
            </button>
          );
        })}
      </nav>

      <div className="topbar-actions">
        <div className="lang-toggle" role="group" aria-label={t(lang, 'langSwitch')}>
          {(['ko', 'en'] as const).map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={lang === code}
              className={lang === code ? 'on' : ''}
              onClick={() => onLang(code)}
              data-testid={`lang-${code}`}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={onTheme}
          aria-label={theme === 'dark' ? t(lang, 'themeToLight') : t(lang, 'themeToDark')}
          aria-pressed={theme === 'dark'}
          title={theme === 'dark' ? t(lang, 'themeToLight') : t(lang, 'themeToDark')}
          data-testid="theme-toggle"
        >
          {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
        </button>
        <PortalMenu lang={lang} onResetFiles={onResetFiles} onClearTerminal={onClearTerminal} />
      </div>
    </header>
  );
}
