/**
 * The `completion` slot: connection fields plus the five views a chat
 * completion request produces — request JSON, response JSON, the assistant
 * message, token usage and the SSE chunks.
 *
 * The panel is a card with tabs rather than five separate cards so the right
 * column stays readable on a laptop and on a phone. Everything it shows is
 * derived from the last run's trace; the trace was already masked by the
 * Python client, and `redactTrace` masks the key a second time here.
 */
import { useMemo, useState } from 'react';
import { t, type Lang } from '../i18n';
import type { CompletionSettings } from '../state/completion';
import type { RunOutput } from '../state/useSandbox';
import { redactTrace, type TraceEvent } from '../tracks/python/trace';

type Tab = 'request' | 'response' | 'assistant' | 'usage' | 'stream';

const TABS: Tab[] = ['request', 'response', 'assistant', 'usage', 'stream'];

const tabKey: Record<Tab, 'completionTabRequest' | 'completionTabResponse' | 'completionTabAssistant' | 'completionTabUsage' | 'completionTabStream'> = {
  request: 'completionTabRequest',
  response: 'completionTabResponse',
  assistant: 'completionTabAssistant',
  usage: 'completionTabUsage',
  stream: 'completionTabStream',
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const lastEvent = (events: TraceEvent[], kind: TraceEvent['kind']): unknown => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].kind === kind) return events[index].data;
  }
  return undefined;
};

const assistantOf = (events: TraceEvent[]): { content: string; finish: string | null } => {
  const response = asRecord(lastEvent(events, 'response'));
  const choices = response?.choices;
  const choice = Array.isArray(choices) ? asRecord(choices[0]) : null;
  const message = asRecord(choice?.message);
  if (typeof message?.content === 'string') {
    return { content: message.content, finish: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null };
  }
  const fallback = asRecord(lastEvent(events, 'assistant'));
  return {
    content: typeof fallback?.content === 'string' ? fallback.content : '',
    finish: null,
  };
};

const usageOf = (events: TraceEvent[]): Record<string, unknown> | null => {
  const direct = asRecord(lastEvent(events, 'usage'));
  if (direct) return direct;
  return asRecord(asRecord(lastEvent(events, 'response'))?.usage);
};

const chunksOf = (events: TraceEvent[]): string[] => {
  const pieces: string[] = [];
  for (const event of events) {
    if (event.kind !== 'chunk') continue;
    const chunk = asRecord(event.data);
    const choices = chunk?.choices;
    const choice = Array.isArray(choices) ? asRecord(choices[0]) : null;
    const delta = asRecord(choice?.delta);
    if (typeof delta?.content === 'string' && delta.content !== '') pieces.push(delta.content);
  }
  return pieces;
};

const pretty = (value: unknown): string => {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const errorText = (events: TraceEvent[], run: RunOutput | null): string => {
  const error = asRecord(lastEvent(events, 'error'));
  if (typeof error?.message === 'string') {
    return typeof error.status === 'number' ? `HTTP ${error.status}: ${error.message}` : error.message;
  }
  return run?.error ?? '';
};

interface CompletionPanelProps {
  lang: Lang;
  settings: CompletionSettings | null;
  onChange: (patch: Partial<CompletionSettings>) => void;
  run: RunOutput | null;
  running: boolean;
  stale: boolean;
}

export function CompletionPanel({ lang, settings, onChange, run, running, stale }: CompletionPanelProps) {
  const [tab, setTab] = useState<Tab>('request');
  const events = useMemo(
    () => redactTrace(run?.trace ?? [], settings?.apiKey ?? ''),
    [run?.trace, settings?.apiKey],
  );
  const request = lastEvent(events, 'request');
  const response = lastEvent(events, 'response');
  const assistant = assistantOf(events);
  const usage = usageOf(events);
  const chunks = chunksOf(events);
  const failure = errorText(events, run);
  const mock = settings?.mode !== 'live';
  const hasTrace = events.length > 0;

  const empty = running ? t(lang, 'completionWaiting') : hasTrace ? t(lang, 'completionEmpty') : t(lang, 'completionRunFirst');

  return (
    <div className="viz-card completion-card" data-testid="completion-panel" data-mode={mock ? 'mock' : 'live'}>
      <div className="viz-head">
        <span>{t(lang, 'completionTitle')}</span>
        <span className={`mode-pill ${mock ? 'mock' : 'live'}`} data-testid="completion-mode">
          {mock ? t(lang, 'completionMock') : t(lang, 'completionLive')}
        </span>
      </div>

      <div className="mode-toggle" role="group" aria-label={t(lang, 'completionTitle')}>
        <button
          type="button"
          className={mock ? 'on' : ''}
          onClick={() => onChange({ mode: 'mock' })}
          data-testid="completion-mode-mock"
        >
          {t(lang, 'completionMock')}
        </button>
        <button
          type="button"
          className={!mock ? 'on' : ''}
          onClick={() => onChange({ mode: 'live' })}
          data-testid="completion-mode-live"
        >
          {t(lang, 'completionLive')}
        </button>
      </div>
      <p className="completion-note">{mock ? t(lang, 'completionMockNote') : t(lang, 'completionLiveNote')}</p>

      <div className="completion-form">
        <label>
          <span>{t(lang, 'completionBaseUrl')}</span>
          <input
            type="url"
            value={settings?.baseUrl ?? ''}
            disabled={mock}
            spellCheck={false}
            autoComplete="off"
            placeholder="https://provider.example/v1"
            onChange={(event) => onChange({ baseUrl: event.target.value })}
            data-testid="completion-base-url"
          />
        </label>
        <label>
          <span>{t(lang, 'completionApiKey')}</span>
          <input
            type="password"
            value={settings?.apiKey ?? ''}
            disabled={mock}
            spellCheck={false}
            autoComplete="off"
            placeholder={mock ? t(lang, 'completionMockNoKey') : 'sk-…'}
            onChange={(event) => onChange({ apiKey: event.target.value })}
            data-testid="completion-api-key"
          />
        </label>
        <label>
          <span>{t(lang, 'completionModel')}</span>
          <input
            type="text"
            value={settings?.model ?? ''}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => onChange({ model: event.target.value })}
            data-testid="completion-model"
          />
        </label>
        <label>
          <span>{t(lang, 'completionSystem')}</span>
          <textarea
            rows={2}
            value={settings?.system ?? ''}
            onChange={(event) => onChange({ system: event.target.value })}
            data-testid="completion-system"
          />
        </label>
        <label>
          <span>{t(lang, 'completionUser')}</span>
          <textarea
            rows={2}
            value={settings?.user ?? ''}
            onChange={(event) => onChange({ user: event.target.value })}
            data-testid="completion-user"
          />
        </label>
        <p className="completion-note">
          {t(lang, 'completionKeyNote')} {t(lang, 'completionPromptNote')}
        </p>
      </div>

      <div className="completion-tabs" role="tablist" aria-label={t(lang, 'completionTitle')}>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'on' : ''}
            onClick={() => setTab(id)}
            data-testid={`completion-tab-${id}`}
          >
            {t(lang, tabKey[id])}
          </button>
        ))}
      </div>

      <div className="completion-body">
        {tab === 'request' && (
          request === undefined ? (
            <p className="viz-empty">{empty}</p>
          ) : (
            <>
              <pre className="out-block" data-testid="completion-request">{pretty(request)}</pre>
              <p className="completion-note">{t(lang, 'completionMasked')}</p>
            </>
          )
        )}

        {tab === 'response' && (
          response !== undefined ? (
            <pre className="out-block" data-testid="completion-response">{pretty(response)}</pre>
          ) : failure ? (
            <pre className="out-block err" data-testid="completion-error">{failure}</pre>
          ) : (
            <p className="viz-empty">{empty}</p>
          )
        )}

        {tab === 'assistant' && (
          assistant.content ? (
            <>
              <pre className="out-block assistant" data-testid="completion-assistant">{assistant.content}</pre>
              {assistant.finish && (
                <p className="completion-note">
                  finish_reason: <code>{assistant.finish}</code>
                </p>
              )}
            </>
          ) : failure ? (
            <p className="viz-error">{failure}</p>
          ) : (
            <p className="viz-empty">{empty}</p>
          )
        )}

        {tab === 'usage' && (
          usage ? (
            <div className="completion-stats" data-testid="completion-usage">
              {(['prompt_tokens', 'completion_tokens', 'total_tokens'] as const).map((key) => (
                <div className="completion-stat" key={key}>
                  <span>{key}</span>
                  <b>{typeof usage[key] === 'number' ? String(usage[key]) : '—'}</b>
                </div>
              ))}
            </div>
          ) : (
            <p className="viz-empty">{empty}</p>
          )
        )}

        {tab === 'stream' && (
          chunks.length > 0 ? (
            <>
              <p className="completion-note">
                {chunks.length} {t(lang, 'completionChunks')}
              </p>
              <pre className="out-block assistant" data-testid="completion-stream">{chunks.join('')}</pre>
            </>
          ) : (
            <p className="viz-empty">{failure || (running ? t(lang, 'completionWaiting') : t(lang, 'completionNoStream'))}</p>
          )
        )}
      </div>

      {stale && <p className="viz-note" data-testid="completion-stale">{t(lang, 'completionStale')}</p>}
    </div>
  );
}
