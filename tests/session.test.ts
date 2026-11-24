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
import { lessonState, sourceHash } from '../src/state/lesson-state';
import { bootstrapSession, type RunOutput, type Session } from '../src/state/session';
import { evaluateCheck } from '../src/lessons/checks';
import { installFakeWorkers, type FakeWorker } from './fake-worker';
import { __setPythonWorkerFactory } from '../src/tracks/python/runner';

/* eslint-disable @typescript-eslint/no-explicit-any */
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const gitLesson = lessonById('git-basics') as Lesson;
const pythonLesson = lessonById('python-hello') as Lesson;
const chatLesson = lessonById('chat-completion') as Lesson;
const SECRET = 'sk-test-SECRET-123456';

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
  __setPythonWorkerFactory(null);
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

describe('WO-11 · a run belongs to the source it was produced from', () => {
  const sumSource = 'numbers = [12, 45, 7, 23, 88, 34, 61, 15]\nprint(sum(numbers))\n';
  const editedSource = 'numbers = [1]\nprint(sum(numbers))\n# 같은 파일, 다른 내용\n';

  /** Starts a run, answers it with the given stdout, and waits for the hook. */
  const runWith = async (ui: Harness, workers: FakeWorker[], stdout: string) => {
    let pending!: Promise<void>;
    act(() => {
      pending = ui.api.submit('python main.py');
    });
    workers[workers.length - 1].finish(stdout);
    await act(async () => {
      await pending;
    });
  };

  it('does not judge a mission from output whose source has since changed', () => {
    const files = { 'main.py': sumSource };
    const run: RunOutput = {
      stdout: '285',
      stderr: '',
      ms: 3,
      path: 'main.py',
      ok: true,
      sourceHash: sourceHash(files),
    };
    const session: Session = {
      ...bootstrapSession(pythonLesson).session,
      files,
      active: 'main.py',
      lastRun: run,
      lastStdout: '285',
    };
    const sumCheck = pythonLesson.missions.find((mission) => mission.id === 'py-sum')!.check;

    // same files → the output is evidence
    expect(lessonState(pythonLesson, session).stdout).toBe('285');
    expect(evaluateCheck(sumCheck, lessonState(pythonLesson, session))).toBe(true);

    // a later edit makes it worthless, even though `sum(` is still in the file
    const edited: Session = { ...session, files: { 'main.py': editedSource } };
    expect(lessonState(pythonLesson, edited).stdout).toBe('');
    expect(evaluateCheck(sumCheck, lessonState(pythonLesson, edited))).toBe(false);
  });

  it('blocks the award when the learner edits while the program is running', async () => {
    const workers = installFakeWorkers();
    const ui = mount(pythonLesson);
    try {
      ui.type('main.py', sumSource);
      let pending!: Promise<void>;
      act(() => {
        pending = ui.api.submit('python main.py');
      });
      // the program is still running when the editor changes
      ui.type('main.py', editedSource);
      workers[0].finish('285');
      await act(async () => {
        await pending;
      });

      expect(ui.api.session.lastRun?.ok).toBe(true);
      expect(ui.api.staleRun).toBe(true);
      expect(ui.api.session.done).not.toContain('py-sum');

      // the edited source is what counts now, and it prints 1, not 285
      await runWith(ui, workers, '1');
      expect(ui.api.staleRun).toBe(false);
      expect(ui.api.session.done).not.toContain('py-sum');

      ui.type('main.py', sumSource);
      await runWith(ui, workers, '285');
      expect(ui.api.session.done).toContain('py-sum');
    } finally {
      ui.unmount();
    }
  });
});

describe('chat completion · the key lives in memory only', () => {
  it('hands the key to the worker but never writes it to the session', async () => {
    const workers = installFakeWorkers();
    const first = mount(chatLesson);
    try {
      act(() => {
        first.api.setCompletion({
          mode: 'live',
          baseUrl: 'https://provider.example/v1',
          apiKey: SECRET,
          model: 'test-model',
        });
      });
      let pending!: Promise<void>;
      act(() => {
        pending = first.api.submit('python main.py');
      });
      expect(workers[0].sent[0]).toMatchObject({
        type: 'run',
        env: {
          LLM_MODE: 'live',
          LLM_BASE_URL: 'https://provider.example/v1',
          LLM_API_KEY: SECRET,
          LLM_MODEL: 'test-model',
        },
      });
      workers[0].finish('mode: live');
      await act(async () => {
        await pending;
      });
      await settleStorage();

      expect(first.api.completion?.apiKey).toBe(SECRET);
      expect(first.api.session.lastRun?.stdout).toBe('mode: live');
      expect(JSON.stringify(first.api.session)).not.toContain(SECRET);
      expect(JSON.stringify(window.localStorage)).not.toContain(SECRET);
    } finally {
      first.unmount();
    }

    const second = mount(chatLesson);
    try {
      expect(second.api.completion?.apiKey).toBe('');
      expect(second.api.completion?.mode).toBe('mock');
      expect(JSON.stringify(second.api.session)).not.toContain(SECRET);
    } finally {
      second.unmount();
    }
  });

  it('does not hand the key to the worker in Mock Mode and snapshots the settings', async () => {
    const workers = installFakeWorkers();
    const ui = mount(chatLesson);
    try {
      act(() => {
        ui.api.setCompletion({ mode: 'mock', model: 'mock-1', apiKey: SECRET });
      });
      let pending!: Promise<void>;
      act(() => {
        pending = ui.api.submit('python main.py');
      });
      expect(workers[0].sent[0]).toMatchObject({
        type: 'run',
        env: { LLM_MODE: 'mock', LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL: 'mock-1' },
      });

      act(() => {
        workers[0].send({ type: 'delta', requestId: workers[0].lastRequestId, text: '첫 조각', at: Date.now() });
      });
      expect(ui.api.stream).toMatchObject({ text: '첫 조각', chunks: 1 });

      workers[0].finish('mode: mock', { trace: [{ kind: 'preview', data: { body: { messages: [] } } }] });
      await act(async () => {
        await pending;
      });

      const run = ui.api.session.lastRun;
      expect(run?.config).toMatchObject({ mode: 'mock', model: 'mock-1' });
      expect(JSON.stringify(run?.config)).not.toContain(SECRET);
      expect(ui.api.stream).toBeNull();
      expect(ui.api.staleConfig).toBe(false);

      // A settings edit belongs to a new configuration: the old run is not evidence.
      act(() => {
        ui.api.setCompletion({ model: 'mock-2' });
      });
      expect(ui.api.staleConfig).toBe(true);
      expect(ui.api.staleRun).toBe(true);
    } finally {
      ui.unmount();
    }
  });
});

describe('WO-12 · a lesson with no files at all', () => {  it('keeps an empty working tree through a reload and creates the next file from it', async () => {
    const first = mount(gitLesson);
    await first.submit('git init');
    await first.submit('git add .');
    await first.submit('git commit -m "첫 커밋"');
    await first.submit('git rm README.md hello.txt notes.md');
    expect(first.api.session.files).toEqual({});
    expect(first.api.session.active).toBe('');
    expect(first.api.session.gitSnap?.unstaged).toEqual([]);
    await settleStorage();
    first.unmount();

    const second = mount(gitLesson);
    try {
      // the empty file list came back instead of the lesson's starting files
      expect(second.api.session.files).toEqual({});
      expect(second.api.session.active).toBe('');
      expect(second.api.session.done).toContain('git-init');

      act(() => second.api.createFile('fresh.md'));
      expect(second.api.session.files).toEqual({ 'fresh.md': '' });
      expect(second.api.session.active).toBe('fresh.md');
      second.type('fresh.md', '# 새 파일\n');
      await second.submit('git status');
      expect(second.api.session.gitSnap?.untracked).toEqual(['fresh.md']);
    } finally {
      second.unmount();
    }
  });

  it('accepts a saved session that holds an empty file list', () => {
    const payload = {
      version: 3,
      files: {},
      active: '',
      done: ['git-init'],
      missionIndex: 1,
      free: false,
      git: null,
      savedAt: Date.now(),
    };
    window.localStorage.setItem('codeplayground:session:v3:git-basics', JSON.stringify(payload));
    const ui = mount(gitLesson);
    try {
      expect(ui.api.session.files).toEqual({});
      expect(ui.api.session.active).toBe('');
      expect(ui.api.session.done).toEqual(['git-init']);
    } finally {
      ui.unmount();
    }
  });
});
