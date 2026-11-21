import { useEffect, useRef, useState } from 'react';
import { t, type Lang } from '../i18n';
import type { TermEntry } from '../state/useSandbox';
import type { OutLine } from '../tracks/types';
import { IconTrash } from './Icons';

interface TerminalProps {
  lang: Lang;
  prompt: string;
  entries: TermEntry[];
  history: string[];
  chips: string[];
  running: boolean;
  onCommand: (command: string) => void;
  onClear: () => void;
  onComplete: (input: string) => string | null;
}

function Line({ line }: { line: OutLine }) {
  if (line.spans && line.spans.length) {
    return (
      <div className={`term-line${line.tone ? ` tone-${line.tone}` : ''}`}>
        {line.spans.map((span, index) => (
          <span key={index} className={span.tone ? `tone-${span.tone}` : undefined}>
            {span.text}
          </span>
        ))}
      </div>
    );
  }
  return <div className={`term-line${line.tone ? ` tone-${line.tone}` : ''}`}>{line.text || '\u00a0'}</div>;
}

export function Terminal({ lang, prompt, entries, history, chips, running, onCommand, onClear, onComplete }: TerminalProps) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [entries.length]);

  const send = () => {
    const command = value;
    if (!command.trim()) return;
    setValue('');
    setCursor(null);
    onCommand(command);
  };

  const recall = (direction: -1 | 1) => {
    if (history.length === 0) return;
    const nextIndex = cursor === null ? (direction === -1 ? history.length - 1 : null) : cursor + direction;
    if (nextIndex === null || nextIndex >= history.length) {
      setCursor(null);
      setValue('');
      return;
    }
    if (nextIndex < 0) {
      setCursor(0);
      setValue(history[0]);
      return;
    }
    setCursor(nextIndex);
    setValue(history[nextIndex]);
  };

  return (
    <section className="terminal pane" aria-label={t(lang, 'terminalTitle')}>
      <div className="pane-head term-head">
        <span className="pane-title">{t(lang, 'terminalTitle')}</span>
        <span className="term-hint">{t(lang, 'terminalHint')}</span>
        <button type="button" className="side-action" onClick={onClear} aria-label={t(lang, 'clear')} title={t(lang, 'clear')}>
          <IconTrash size={13} />
        </button>
      </div>
      <div className="term-body" ref={bodyRef} onClick={() => inputRef.current?.focus()} data-testid="terminal">
        {entries.length === 0 && (
          <div className="term-line tone-dim">
            {lang === 'ko'
              ? '왼쪽 미션을 따라 명령을 입력해 보세요. help 를 입력하면 도움말이 나옵니다.'
              : 'Follow a mission on the left, or type help for the command list.'}
          </div>
        )}
        {entries.map((entry) =>
          entry.kind === 'cmd' ? (
            <div key={entry.id} className="term-cmd">
              {entry.lines.map((line, index) => (
                <div key={index} className="term-line">
                  {index === 0 && <span className="prompt">{entry.prompt}</span>}
                  {index > 0 && <span className="prompt-caret">{'> '}</span>}
                  <span>{line.text}</span>
                </div>
              ))}
            </div>
          ) : entry.kind === 'note' ? (
            <div key={entry.id} className="term-note">
              {entry.lines.map((line, index) => (
                <Line key={index} line={line} />
              ))}
            </div>
          ) : (
            <div key={entry.id} className="term-out">
              {entry.lines.map((line, index) => (
                <Line key={index} line={line} />
              ))}
            </div>
          ),
        )}
        <div className="term-input-row">
          <label className="prompt" htmlFor="term-input">
            {prompt}
          </label>
          <input
            id="term-input"
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                send();
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                recall(-1);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                recall(1);
              } else if (event.key === 'Tab') {
                const completed = onComplete(value);
                if (completed) {
                  event.preventDefault();
                  setValue(completed);
                }
              } else if (event.key === 'l' && event.ctrlKey) {
                event.preventDefault();
                onClear();
              }
            }}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={running ? t(lang, 'running') : t(lang, 'terminalPlaceholder')}
            aria-label={t(lang, 'terminalPlaceholder')}
            data-testid="term-input"
          />
        </div>
      </div>
      {chips.length > 0 && (
        <div className="term-chips" aria-label={t(lang, 'quickCommands')}>
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              className="chip"
              title={t(lang, 'chipHint')}
              onClick={() => {
                setValue(chip);
                inputRef.current?.focus();
              }}
            >
              {chip}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
