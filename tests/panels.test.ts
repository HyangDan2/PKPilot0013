import { describe, expect, it } from 'vitest';
import { DEFAULT_PANELS, PANEL_ORDER, panelLabel, resolvePanels } from '../src/components/PanelSlots';

describe('panel slot mapping', () => {
  it('keeps the order the lesson declared', () => {
    expect(resolvePanels(['working-tree', 'git-graph'])).toEqual(['working-tree', 'git-graph']);
    expect(resolvePanels(['git-graph', 'working-tree'])).toEqual(['git-graph', 'working-tree']);
    expect(resolvePanels(['output'])).toEqual(['output']);
  });

  it('drops unknown ids and duplicates instead of rendering empty cards', () => {
    expect(resolvePanels(['output', 'sql-table', 'output', '', 'git-graph'])).toEqual(['output', 'git-graph']);
  });

  it('falls back to the runtime default when nothing usable is declared', () => {
    expect(resolvePanels([], DEFAULT_PANELS.git)).toEqual(['git-graph', 'working-tree']);
    expect(resolvePanels(['nope'], DEFAULT_PANELS.python)).toEqual(['output']);
    expect(resolvePanels([])).toEqual(['output']);
  });

  it('labels every slot the shell can draw', () => {
    for (const id of PANEL_ORDER) {
      expect(panelLabel('ko', id)).not.toBe('');
      expect(panelLabel('en', id)).not.toBe('');
    }
    expect(panelLabel('ko', 'output')).toBe('실행 결과');
    expect(panelLabel('ko', 'working-tree')).toBe('작업 트리');
  });
});
