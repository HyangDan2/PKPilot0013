/**
 * The right column is assembled from slots, not hard-wired to a runtime: a
 * lesson's frontmatter `panels` decides which cards exist and in what order.
 * Unknown ids are dropped (the loader rejects them at build time anyway), and a
 * lesson that declares none falls back to its runtime's default card.
 */
import { t, type Lang } from '../i18n';
import type { PanelId } from '../lessons/types';
import type { GitSnapshot } from '../tracks/git/repo';
import type { PythonProgress } from '../tracks/python/runner';
import type { RunOutput } from '../state/useSandbox';
import { GitGraph, GitStatus } from './GitPanels';
import { PythonOutput } from './Visualizers';

export const PANEL_ORDER: PanelId[] = ['output', 'git-graph', 'working-tree'];

export const DEFAULT_PANELS: Record<'python' | 'git', PanelId[]> = {
  python: ['output'],
  git: ['git-graph', 'working-tree'],
};

/** Keep the declared order, drop duplicates and anything the shell cannot draw. */
export function resolvePanels(declared: readonly string[], fallback: PanelId[] = DEFAULT_PANELS.python): PanelId[] {
  const resolved: PanelId[] = [];
  for (const raw of declared) {
    const id = raw as PanelId;
    if (!PANEL_ORDER.includes(id) || resolved.includes(id)) continue;
    resolved.push(id);
  }
  return resolved.length > 0 ? resolved : [...fallback];
}

export const panelLabel = (lang: Lang, id: PanelId): string => {
  if (id === 'output') return t(lang, 'outputPython');
  if (id === 'git-graph') return t(lang, 'gitGraph');
  return t(lang, 'gitWorktree');
};

interface PanelSlotsProps {
  lang: Lang;
  declared: readonly string[];
  fallback: PanelId[];
  gitSnap: GitSnapshot | null;
  run: RunOutput | null;
  progress: PythonProgress;
  running: boolean;
}

export function PanelSlots({ lang, declared, fallback, gitSnap, run, progress, running }: PanelSlotsProps) {
  const panels = resolvePanels(declared, fallback);
  return (
    <>
      {panels.map((id) => (
        <div className="slot" key={id} data-panel={id}>
          {id === 'output' && (
            <PythonOutput lang={lang} run={run} progress={progress} running={running} />
          )}
          {id === 'git-graph' && <GitGraph lang={lang} snap={gitSnap} />}
          {id === 'working-tree' && <GitStatus lang={lang} snap={gitSnap} />}
        </div>
      ))}
    </>
  );
}
