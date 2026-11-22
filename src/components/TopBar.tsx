import { t, type Lang } from '../i18n';
import { IconMoon, IconSun } from './Icons';
import { PortalMenu } from './PortalMenu';

interface TopBarProps {
  lang: Lang;
  onLang: (lang: Lang) => void;
  theme: 'dark' | 'light';
  onTheme: () => void;
  onHome: () => void;
  /** Present only inside a lesson, where there is something to reset. */
  onResetFiles?: () => void;
  onClearTerminal?: () => void;
}

/**
 * The HD2Lab title bar, slimmed to the standard four controls: the logo (the way
 * back to the lesson catalog), KO | EN, the theme toggle and ⋮.
 */
export function TopBar({ lang, onLang, theme, onTheme, onHome, onResetFiles, onClearTerminal }: TopBarProps) {
  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={onHome} title={t(lang, 'navHome')} data-testid="brand-home">
        <span className="mark" aria-hidden />
        <span className="brand-name">HD2Lab</span>
        <span className="brand-pipe" aria-hidden />
        <span className="brand-app">CodePlayground</span>
      </button>

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
        <PortalMenu lang={lang} onHome={onHome} onResetFiles={onResetFiles} onClearTerminal={onClearTerminal} />
      </div>
    </header>
  );
}
