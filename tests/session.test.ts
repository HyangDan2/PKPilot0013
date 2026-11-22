/**
 * React integration: the hook that turns engine output into what the learner
 * sees (WO-01) and the save/restore policy (WO-06).
 *
 * Each case mounts the real `useSandbox` the IDE uses, drives it through the
 * same `submit` path the terminal uses, and reads the session the editor and
 * mission cards are rendered from.
 */
import { createElement, useEffect } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lessonById } from '../src/lessons';
import type { Lesson } from '../src/lessons/types';
import { useSandbox, type SandboxApi } from '../src/state/useSandbox';

/* eslint-disable @typescript-eslint/no-explicit-any */
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const gitLesson = lessonById('git-basics') as Lesson;
const pythonLesson = lessonById('python-hello') as Lesson;

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

const settleStorage = () => new Promise((resolve) => setTimeout(resolve, 260));

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

describe('WO-01 · the editor follows the Git engine', () => {
  it('shows the files of the branch the learner switched to', async () => {
    const ui = mount(gitLesson);
    try {
      await ui.submit('git init');
      await ui.submit('git add .');
      await ui.submit('git commit -m "첫 커밋"');

      await ui.submit('git switch -c feature');
      ui.type('README.md', '# feature 브랜치의 README\n');
      await ui.submit('git add .');
      await ui.submit('git commit -m "feature 작업"');
      expect(ui.api.session.files['README.md']).toBe('# feature 브랜치의 README\n');

      await ui.submit('git switch main');
      expect(ui.api.session.files['README.md']).toBe(gitLesson.files['README.md']);
      expect(ui.api.session.gitSnap?.branch).toBe('main');

      await ui.submit('git switch feature');
      expect(ui.api.session.files['README.md']).toBe('# feature 브랜치의 README\n');
    } finally {
      ui.unmount();
    }
  });

  it('moves the editor to a surviving file when the open file is removed', async () => {
    const ui = mount(gitLesson);
    try {
      await ui.submit('git init');
      await ui.submit('git add .');
      await ui.submit('git commit -m "첫 커밋"');
      act(() => ui.api.openFile('hello.txt'));
      expect(ui.api.session.active).toBe('hello.txt');

      await ui.submit('git rm hello.txt');
      expect(ui.api.session.files['hello.txt']).toBeUndefined();
      expect(ui.api.session.active).not.toBe('hello.txt');
      expect(ui.api.session.files[ui.api.session.active]).toBeDefined();
      expect(ui.api.session.gitSnap?.staged).toEqual([{ path: 'hello.txt', status: 'deleted' }]);
    } finally {
      ui.unmount();
    }
  });

  it('reflects a reset --hard in the editor but keeps an untracked file', async () => {
    const ui = mount(gitLesson);
    try {
      await ui.submit('git init');
      await ui.submit('git add .');
      await ui.submit('git commit -m "첫 커밋"');
      ui.type('README.md', 'dirty\n');
      act(() => ui.api.createFile('scratch.md'));
      ui.type('scratch.md', 'mine\n');

      await ui.submit('git reset --hard HEAD');
      expect(ui.api.session.files['README.md']).toBe(gitLesson.files['README.md']);
      expect(ui.api.session.files['scratch.md']).toBe('mine\n');
      expect(ui.api.session.gitSnap?.untracked).toEqual(['scratch.md']);
    } finally {
      ui.unmount();
    }
  });

  it('shows a refused switch in the terminal and leaves the files alone', async () => {
    const ui = mount(gitLesson);
    try {
      await ui.submit('git init');
      await ui.submit('git add .');
      await ui.submit('git commit -m "첫 커밋"');
      await ui.submit('git switch -c feature');
      ui.type('hello.txt', 'feature 쪽\n');
      await ui.submit('git add .');
      await ui.submit('git commit -m "feature"');
      await ui.submit('git switch main');
      ui.type('hello.txt', '로컬 수정\n');

      await ui.submit('git switch feature');
      const output = ui.api.session.term
        .filter((entry) => entry.kind === 'out')
        .slice(-1)[0]
        .lines.map((line) => line.text)
        .join('\n');
      expect(output).toContain('would be overwritten by checkout');
      expect(ui.api.session.files['hello.txt']).toBe('로컬 수정\n');
      expect(ui.api.session.gitSnap?.branch).toBe('main');
    } finally {
      ui.unmount();
    }
  });
});

describe('WO-06 · coming back where you left off', () => {
  it('restores files, the open file, completed missions and the current mission', async () => {
    const first = mount(gitLesson);
    await first.submit('git init');
    await first.submit('git add .');
    await first.submit('git commit -m "첫 커밋"');
    await first.submit('git switch -c feature');
    first.type('notes.md', '# 메모\n');
    const doneBefore = [...first.api.session.done];
    const missionBefore = first.api.session.missionIndex;
    expect(doneBefore.length).toBeGreaterThanOrEqual(2);
    first.unmount();

    const second = mount(gitLesson);
    try {
      expect(second.api.session.done).toEqual(doneBefore);
      expect(second.api.session.missionIndex).toBe(missionBefore);
      expect(second.api.session.files['notes.md']).toBe('# 메모\n');
      // and the repository itself came back: a reload must not lose commits
      expect(second.api.session.gitSnap?.initialized).toBe(true);
      expect(second.api.session.gitSnap?.totalCommits).toBe(1);
      expect(second.api.session.gitSnap?.branch).toBe('feature');
    } finally {
      second.unmount();
    }
  });

  it('restores a conflicted merge so the learner can still resolve it', async () => {
    const first = mount(gitLesson);
    await first.submit('git init');
    await first.submit('git add .');
    await first.submit('git commit -m "base"');
    await first.submit('git switch -c feature');
    first.type('hello.txt', 'feature 쪽\n');
    await first.submit('git add .');
    await first.submit('git commit -m "feature"');
    await first.submit('git switch main');
    first.type('hello.txt', 'main 쪽\n');
    await first.submit('git add .');
    await first.submit('git commit -m "main"');
    await first.submit('git merge feature');
    expect(first.api.session.gitSnap?.mergePending).toBe('feature');
    first.unmount();

    const second = mount(gitLesson);
    try {
      expect(second.api.session.gitSnap?.mergePending).toBe('feature');
      expect(second.api.session.files['hello.txt']).toContain('<<<<<<< HEAD');
    } finally {
      second.unmount();
    }
  });

  it('starts from the markdown again after the lesson is restarted', async () => {
    const ui = mount(gitLesson);
    try {
      await ui.submit('git init');
      ui.type('notes.md', '# 임시\n');
      await settleStorage();
      expect(ui.api.session.done.length).toBeGreaterThanOrEqual(1);

      act(() => {
        ui.api.resetLesson();
      });
      expect(ui.api.session.done).toEqual([]);
      expect(ui.api.session.files).toEqual(gitLesson.files);
      expect(ui.api.session.gitSnap?.initialized).toBe(false);
      await settleStorage();
      const third = mount(gitLesson);
      try {
        expect(third.api.session.done).toEqual([]);
        expect(third.api.session.files).toEqual(gitLesson.files);
      } finally {
        third.unmount();
      }
    } finally {
      ui.unmount();
    }
  });

  it('keeps python edits across a reload', async () => {
    const ui = mount(pythonLesson);
    try {
      ui.type('main.py', 'name = "CodePlayground"\nprint(name)\n');
      await settleStorage();
    } finally {
      ui.unmount();
    }
    const again = mount(pythonLesson);
    try {
      expect(again.api.session.files['main.py']).toContain('CodePlayground');
      expect(again.api.session.active).toBe('main.py');
      expect(again.api.session.runs).toBe(0);
    } finally {
      again.unmount();
    }
  });
});
