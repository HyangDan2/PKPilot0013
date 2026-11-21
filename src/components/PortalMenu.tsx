import { useEffect, useRef, useState } from 'react';
import { t, type Lang } from '../i18n';
import { IconApps, IconBook, IconDots, IconExternal, IconHome, IconReset, IconTerminal } from './Icons';

interface PortalMenuProps {
  lang: Lang;
  onHome: () => void;
  onResetFiles?: () => void;
  onClearTerminal?: () => void;
}

/**
 * The ⋮ menu every HD2Lab title bar carries: back to the lesson catalog, the
 * portal, the catalog of apps, the source — and, inside a lesson, the two
 * housekeeping actions of this workspace.
 */
export function PortalMenu({ lang, onHome, onResetFiles, onClearTerminal }: PortalMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const goHome = () => {
    onHome();
    setOpen(false);
  };

  return (
    <div className="portal" ref={ref}>
      <button
        type="button"
        className={`icon-btn${open ? ' on' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t(lang, 'menuTitle')}
        onClick={() => setOpen((value) => !value)}
        data-testid="portal-menu"
      >
        <IconDots size={18} />
      </button>
      {open && (
        <div className="portal-panel" role="menu" aria-label={t(lang, 'menuTitle')}>
          <p className="portal-head">{t(lang, 'menuTitle')}</p>
          <button type="button" className="portal-item" role="menuitem" onClick={goHome} data-testid="menu-home">
            <span className="portal-ic"><IconBook size={15} /></span>
            <span className="portal-text"><b>{t(lang, 'navHome')}</b><small>{t(lang, 'navHomeHint')}</small></span>
          </button>
          <a className="portal-item" role="menuitem" href="https://hyangdan2.github.io/" target="_blank" rel="noopener noreferrer">
            <span className="portal-ic"><IconHome size={15} /></span>
            <span className="portal-text"><b>{t(lang, 'navWebHq')}</b><small>{t(lang, 'navWebHqHint')}</small></span>
            <IconExternal size={13} />
          </a>
          <a
            className="portal-item"
            role="menuitem"
            href="https://hyangdan2.github.io/ApplicationHub/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="portal-ic"><IconApps size={15} /></span>
            <span className="portal-text"><b>{t(lang, 'navApps')}</b><small>{t(lang, 'navAppsHint')}</small></span>
            <IconExternal size={13} />
          </a>
          <a
            className="portal-item"
            role="menuitem"
            href="https://github.com/HyangDan2/PKPilot0013"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="portal-ic"><IconApps size={15} /></span>
            <span className="portal-text"><b>{t(lang, 'navGithub')}</b><small>{t(lang, 'navGithubHint')}</small></span>
            <IconExternal size={13} />
          </a>
          {onResetFiles && onClearTerminal && (
            <>
              <div className="portal-divider" role="separator" />
              <button
                type="button"
                className="portal-item"
                role="menuitem"
                onClick={() => {
                  onResetFiles();
                  setOpen(false);
                }}
              >
                <span className="portal-ic"><IconReset size={15} /></span>
                <span className="portal-text"><b>{t(lang, 'navResetFiles')}</b><small>{t(lang, 'navResetFilesHint')}</small></span>
              </button>
              <button
                type="button"
                className="portal-item"
                role="menuitem"
                onClick={() => {
                  onClearTerminal();
                  setOpen(false);
                }}
              >
                <span className="portal-ic"><IconTerminal size={15} /></span>
                <span className="portal-text"><b>{t(lang, 'navClearTerminal')}</b><small>{t(lang, 'navClearTerminalHint')}</small></span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
