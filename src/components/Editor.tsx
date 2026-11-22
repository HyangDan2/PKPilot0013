import { useMemo, useRef } from 'react';
import { t, type Lang } from '../i18n';
import type { RuntimeId } from '../tracks/types';
import { IconPlay, IconStop } from './Icons';
import { langForPath, tokenize } from './highlight';

interface EditorProps {
  lang: Lang;
  runtime: RuntimeId;
  files: Record<string, string>;
  active: string;
  running: boolean;
  onChange: (value: string) => void;
  onOpen: (path: string) => void;
  onRun: () => void;
  onStop: () => void;
}

export function Editor({ lang, runtime, files, active, running, onChange, onOpen, onRun, onStop }: EditorProps) {
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const code = files[active] ?? '';
  const lineCount = code.split('\n').length;
  const names = Object.keys(files).sort();
  const runLabel = runtime === 'git' ? t(lang, 'runGit') : t(lang, 'run');
  const tokens = useMemo(() => tokenize(code, langForPath(active)), [code, active]);

  const insertTab = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const area = event.currentTarget;
    const { selectionStart, selectionEnd } = area;
    const next = `${area.value.slice(0, selectionStart)}  ${area.value.slice(selectionEnd)}`;
    const caret = selectionStart + 2;
    onChange(next);
    // the controlled value resets the caret to the end — put it back where the
    // learner was typing, on the next frame.
    requestAnimationFrame(() => {
      area.setSelectionRange(caret, caret);
    });
  };

  const syncScroll = (area: HTMLTextAreaElement) => {
    if (gutterRef.current) gutterRef.current.scrollTop = area.scrollTop;
    if (preRef.current) {
      preRef.current.scrollTop = area.scrollTop;
      preRef.current.scrollLeft = area.scrollLeft;
    }
  };

  return (
    <section className="editor pane" aria-label={t(lang, 'editorTitle')}>
      <div className="pane-head editor-head">
        <div className="tabs" role="tablist" aria-label={t(lang, 'editorTitle')}>
          {names.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={name === active}
              className={`tab${name === active ? ' on' : ''}`}
              onClick={() => onOpen(name)}
              data-testid={`tab-${name}`}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="pane-actions">
          <span className="kbd-hint" title={t(lang, 'stopHint')}>
            ⌘/Ctrl + ↵
          </span>
          {running ? (
            <button
              type="button"
              className="run-btn stop"
              onClick={onStop}
              data-testid="stop"
              title={t(lang, 'stopHintRun')}
            >
              <IconStop size={12} />
              {t(lang, 'stop')}
            </button>
          ) : (
            <button type="button" className="run-btn" onClick={onRun} data-testid="run">
              <IconPlay size={12} />
              {runLabel}
            </button>
          )}
        </div>
      </div>
      <div className="editor-body">
        <div className="gutter" ref={gutterRef} aria-hidden>
          {Array.from({ length: lineCount }, (_, index) => (
            <span key={index}>{index + 1}</span>
          ))}
        </div>
        <div className="code-layer">
          <pre className="code-highlight" ref={preRef} aria-hidden>
            {tokens.map((token, index) =>
              token.cls ? (
                <span key={index} className={`hl-${token.cls}`}>
                  {token.text}
                </span>
              ) : (
                <span key={index}>{token.text}</span>
              ),
            )}
            {'\n'}
          </pre>
          <textarea
            className="code-area"
            value={code}
            spellCheck={false}
            wrap="off"
            aria-label={t(lang, 'editorTitle')}
            data-testid="code-area"
            onChange={(event) => onChange(event.target.value)}
            onScroll={(event) => syncScroll(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === 'Tab') {
                event.preventDefault();
                insertTab(event);
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                onRun();
              }
            }}
          />
        </div>
      </div>
    </section>
  );
}
