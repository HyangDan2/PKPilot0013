/**
 * WO-15 / WO-16 · two tabs, one lesson.
 *
 * A session saved by another tab is a newer revision. This file checks that the
 * stored copy carries revisions, that a stale tab refuses to overwrite it, that
 * the learner is told before anything is lost, and that a session saved by an
 * older build (no revisions, no pre-merge snapshot) still opens.
 */
import { createElement, useEffect } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lessonById } from '../src/lessons';
import type { Lesson } from '../src/lessons/types';
import { useSandbox, type SandboxApi } from '../src/state/useSandbox';
import {
  bootstrapSession,
  readSavedSession,
  subscribeToSessionChanges,
  writeSavedSession,
  type Session,
} from '../src/state/session';
import { GitRepo } from '../src/tracks/git/repo';

/* eslint-disable @typescript-eslint/no-explicit-any */
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const gitLesson = lessonById('git-basics') as Lesson;
const KEY = 'codeplayground:session:v3:git-basics';

interface Harness {
  api: SandboxApi;
  submit: (command: string) => Promise<void>;
  type: (path: string, content: string) => void;
  unmount: () => void;
}

let root: Root | null = null;

function mount(lesson: Lesson): Harness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  let latest: SandboxApi | null = null;
  const Probe = () => {
    const api = useSandbox(lesson, 'ko');
    useEffect(() => {
      latest = api;
    });
    return null;
  };
  act(() => {
    root?.render(createElement(Probe));
  });
  const current = () => {
    if (!latest) throw new Error('the hook did not mount');
    return latest;
  };
  return {
    get api() {
      return current();
    },
    submit: async (command: string) => {
      await act(async () => {
        await current().submit(command);
      });
    },
    type: (path: string, content: string) => {
      act(() => {
        current().setFile(path, content);
      });
    },
    unmount: () => {
      act(() => {
        root?.unmount();
      });
      root = null;
      container.remove();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 260));

/** What another tab's browser would fire at this one. */
const announceToThisTab = (key: string, newValue: string) => {
  const event = new Event('storage') as StorageEvent;
  Object.defineProperty(event, 'key', { value: key });
  Object.defineProperty(event, 'newValue', { value: newValue });
  act(() => window.dispatchEvent(event));
};

const sessionFor = (files: Record<string, string>): Session => ({
  ...bootstrapSession(gitLesson).session,
  files,
  active: Object.keys(files).sort()[0] ?? '',
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  window.localStorage.clear();
});

describe('WO-15 · the stored session carries a revision', () => {
  it('counts every write, and records when it happened', () => {
    const first = writeSavedSession('git-basics', sessionFor({ 'a.txt': '1\n' }), null);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');
    expect(first.revision).toBe(1);

    const second = writeSavedSession('git-basics', sessionFor({ 'a.txt': '2\n' }), null, { baseRevision: 1 });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('unreachable');
    expect(second.revision).toBe(2);

    const stored = readSavedSession('git-basics');
    expect(stored?.revision).toBe(2);
    expect(stored?.updatedAt).toBe(second.updatedAt);
    expect(stored?.files['a.txt']).toBe('2\n');
  });

  it('refuses a write based on an older revision and leaves the newer copy alone', () => {
    writeSavedSession('git-basics', sessionFor({ 'a.txt': 'other tab\n' }), null);
    const result = writeSavedSession('git-basics', sessionFor({ 'a.txt': 'my tab\n' }), null, {
      baseRevision: 0,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.conflict.revision).toBe(1);
    expect(readSavedSession('git-basics')?.files['a.txt']).toBe('other tab\n');
  });

  it('overwrites only when the learner chooses to', () => {
    writeSavedSession('git-basics', sessionFor({ 'a.txt': 'other tab\n' }), null);
    const forced = writeSavedSession('git-basics', sessionFor({ 'a.txt': 'my tab\n' }), null, {
      baseRevision: 0,
      force: true,
    });
    expect(forced.ok).toBe(true);
    if (!forced.ok) throw new Error('unreachable');
    expect(forced.revision).toBe(2);
    expect(readSavedSession('git-basics')?.files['a.txt']).toBe('my tab\n');
  });

  it('reads a save written before revisions existed as revision 0', () => {
    const legacy = {
      version: 3,
      files: { 'README.md': '# 예전 저장\n' },
      active: 'README.md',
      done: ['git-init'],
      missionIndex: 1,
      free: false,
      git: null,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(KEY, JSON.stringify(legacy));
    const saved = readSavedSession('git-basics');
    expect(saved?.revision).toBe(0);
    expect(saved?.done).toEqual(['git-init']);
    const next = writeSavedSession('git-basics', sessionFor({ 'README.md': '# 새 저장\n' }), null, {
      baseRevision: saved?.revision,
    });
    expect(next.ok).toBe(true);
  });

  it('tells a listener when another tab saves, and stops when unsubscribed', () => {
    const changes: number[] = [];
    const unsubscribe = subscribeToSessionChanges('git-basics', (change) => changes.push(change.revision));

    writeSavedSession('git-basics', sessionFor({ 'a.txt': 'one\n' }), null);
    const raw = window.localStorage.getItem(KEY) as string;
    announceToThisTab(KEY, raw);
    expect(changes).toEqual([1]);

    // another lesson's key must not be mistaken for this one
    announceToThisTab('codeplayground:session:v3:python-hello', raw);
    expect(changes).toEqual([1]);

    unsubscribe();
    announceToThisTab(KEY, raw);
    expect(changes).toEqual([1]);
  });
});

describe('WO-15 · two tabs on the same lesson', () => {
  it('follows the other tab when this one has nothing unsaved', async () => {
    const ui = mount(gitLesson);
    try {
      await settle();
      const remote = writeSavedSession(
        'git-basics',
        sessionFor({ 'README.md': '# 다른 탭에서 고침\n' }),
        null,
      );
      expect(remote.ok).toBe(true);
      announceToThisTab(KEY, window.localStorage.getItem(KEY) as string);
      await settle();

      expect(ui.api.syncConflict).toBeNull();
      expect(ui.api.session.files['README.md']).toBe('# 다른 탭에서 고침\n');
    } finally {
      ui.unmount();
    }
  });

  it('stops an overwrite and asks before discarding the other tab’s work', async () => {
    const ui = mount(gitLesson);
    try {
      await settle();
      writeSavedSession('git-basics', sessionFor({ 'README.md': '# 다른 탭\n' }), null);
      announceToThisTab(KEY, window.localStorage.getItem(KEY) as string);
      await settle();
      expect(ui.api.session.files['README.md']).toBe('# 다른 탭\n');

      // now this tab edits, and another tab saves before the debounce fires
      ui.type('README.md', '# 이 탭에서 고침\n');
      writeSavedSession('git-basics', sessionFor({ 'README.md': '# 다른 탭 최신\n' }), null);
      announceToThisTab(KEY, window.localStorage.getItem(KEY) as string);
      await settle();

      expect(ui.api.syncConflict).not.toBeNull();
      // the newer copy on disk was not rolled over
      expect(readSavedSession('git-basics')?.files['README.md']).toBe('# 다른 탭 최신\n');
      // and the editor still shows this tab's work, not a silent mix
      expect(ui.api.session.files['README.md']).toBe('# 이 탭에서 고침\n');

      act(() => ui.api.resolveSync('mine'));
      await settle();
      expect(ui.api.syncConflict).toBeNull();
      expect(readSavedSession('git-basics')?.files['README.md']).toBe('# 이 탭에서 고침\n');
    } finally {
      ui.unmount();
    }
  });

  it('loads the other tab’s copy when the learner picks it', async () => {
    const ui = mount(gitLesson);
    try {
      await settle();
      ui.type('README.md', '# 이 탭\n');
      writeSavedSession('git-basics', sessionFor({ 'README.md': '# 저 탭\n' }), null);
      announceToThisTab(KEY, window.localStorage.getItem(KEY) as string);
      await settle();
      expect(ui.api.syncConflict).not.toBeNull();

      act(() => ui.api.resolveSync('theirs'));
      await settle();
      expect(ui.api.syncConflict).toBeNull();
      expect(ui.api.session.files['README.md']).toBe('# 저 탭\n');
    } finally {
      ui.unmount();
    }
  });

  it('keeps restoring a session with no other tab involved', async () => {
    const first = mount(gitLesson);
    await first.submit('git init');
    await first.submit('git add .');
    await first.submit('git commit -m "첫 커밋"');
    first.type('notes.md', '# 자동 복원\n');
    await settle();
    first.unmount();

    const second = mount(gitLesson);
    try {
      expect(second.api.session.files['notes.md']).toBe('# 자동 복원\n');
      expect(second.api.session.gitSnap?.totalCommits).toBe(1);
      expect(second.api.syncConflict).toBeNull();
    } finally {
      second.unmount();
    }
  });
});

describe('WO-16 · a merge saved by an older build', () => {
  /** The state a learner had when they closed the tab mid-conflict. */
  const legacyConflictedSave = () => {
    const repo = new GitRepo({
      'app.js': 'base\n',
      'notes.md': 'notes\n',
      'extra.txt': 'extra\n',
    });
    const run = (command: string) => repo.exec(command);
    run('git init');
    run('git add .');
    run('git commit -m "base"');
    run('git switch -c feature');
    repo.workdir['app.js'] = 'feature\n';
    run('git add .');
    run('git commit -m "feature"');
    run('git switch main');
    repo.workdir['app.js'] = 'main\n';
    run('git add .');
    run('git commit -m "main"');
    run('git merge feature');

    const saved = JSON.parse(JSON.stringify(repo.serialize())) as Record<string, unknown>;
    delete saved.mergeState;
    delete saved.unmergedPaths;
    return saved;
  };

  it('restores the conflict and still refuses to commit past it', async () => {
    const git = legacyConflictedSave();
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 3,
        files: {},
        active: 'app.js',
        done: [],
        missionIndex: 0,
        free: false,
        git,
        savedAt: Date.now(),
      }),
    );

    const ui = mount(gitLesson);
    try {
      const snap = ui.api.session.gitSnap;
      expect(snap?.mergePending).toBe('feature');
      expect(snap?.unmerged).toEqual(['app.js']);
      expect(snap?.mergeStateAvailable).toBe(false);
      expect(ui.api.session.files['app.js']).toContain('<<<<<<< HEAD');

      await ui.submit('git commit -m "merge"');
      const output = ui.api.session.term
        .filter((entry) => entry.kind === 'out')
        .slice(-1)[0]
        .lines.map((line) => line.text)
        .join('\n');
      expect(output).toContain('unmerged files');
      expect(ui.api.session.gitSnap?.mergePending).toBe('feature');
    } finally {
      ui.unmount();
    }
  });

  it('warns in the working-tree panel that abort cannot restore the work tree', async () => {
    const git = legacyConflictedSave();
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 3,
        files: {},
        active: 'app.js',
        done: [],
        missionIndex: 0,
        free: false,
        git,
        savedAt: Date.now(),
      }),
    );
    const ui = mount(gitLesson);
    try {
      // the panel reads the snapshot; a legacy merge is flagged as not restorable
      expect(ui.api.session.gitSnap?.mergeStateAvailable).toBe(false);
      await ui.submit('git merge --abort');
      expect(ui.api.session.gitSnap?.mergePending).toBeNull();
      expect(ui.api.session.files['app.js']).toBe('main\n');
    } finally {
      ui.unmount();
    }
  });
});
