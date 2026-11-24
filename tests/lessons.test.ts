import { describe, expect, it } from 'vitest';
import { LESSONS, lessonById } from '../src/lessons';
import { LessonParseError, parseLessonDoc, parseYaml, splitFrontmatter } from '../src/lessons/frontmatter';

const yaml = (source: string) => parseYaml(source.replace(/\r\n?/g, '\n'));

describe('frontmatter reader', () => {
  it('reads nested maps, inline collections and block scalars', () => {
    const data = yaml(
      [
        'id: sample',
        'panels: [output, git-graph]',
        'title:',
        '  ko: 제목',
        "  en: 'Title'",
        'files:',
        '  main.py: |',
        '    print("hi")',
        '',
        '    # a blank line stays inside the block',
        '    print(2)',
      ].join('\n'),
    );
    expect(data.id).toBe('sample');
    expect(data.panels).toEqual(['output', 'git-graph']);
    expect(data.title).toEqual({ ko: '제목', en: 'Title' });
    expect(data.files).toEqual({ 'main.py': 'print("hi")\n\n# a blank line stays inside the block\nprint(2)' });
  });

  it('reads list items that open a mapping', () => {
    const data = yaml(
      [
        'missions:',
        '  - id: one',
        '    title:',
        '      ko: 하나',
        '      en: One',
        '    check:',
        '      type: git-commits',
        '      min: 2',
        '  - id: two',
        '    check:',
        '      - type: ran',
        '      - type: stdout-contains',
        "        value: '285'",
      ].join('\n'),
    );
    const missions = data.missions as Record<string, unknown>[];
    expect(missions).toHaveLength(2);
    expect(missions[0]).toMatchObject({ id: 'one', title: { ko: '하나', en: 'One' }, check: { type: 'git-commits', min: 2 } });
    expect(missions[1].check).toEqual([
      { type: 'ran' },
      { type: 'stdout-contains', value: '285' },
    ]);
  });

  it('keeps quoted scalars and rejects an unterminated frontmatter', () => {
    expect(yaml('goal:\n  ko: "따옴표: 안쪽"\n  en: plain')).toEqual({ goal: { ko: '따옴표: 안쪽', en: 'plain' } });
    expect(() => splitFrontmatter('---\nid: x\n')).toThrow(LessonParseError);
    expect(() => splitFrontmatter('id: x\n---\nbody')).toThrow(/first line/);
  });

  it('rejects a lesson whose panels or entry do not exist', () => {
    const base = [
      '---',
      'id: bad',
      'title: 제목',
      'subtitle: 부제',
      'runtime: python',
      'entry: missing.py',
      'files:',
      '  main.py: |',
      '    print(1)',
      '---',
      '본문입니다.',
    ].join('\n');
    expect(() => parseLessonDoc(base)).toThrow(/entry "missing.py"/);
    const badPanel = base.replace('entry: missing.py', 'entry: main.py').replace('runtime: python', 'runtime: python\npanels: [output, nope]');
    expect(() => parseLessonDoc(badPanel)).toThrow(/unknown panel "nope"/);
  });

  it('reads completion defaults and a per-lesson run limit', () => {
    const lesson = parseLessonDoc(
      [
        '---',
        'id: chat',
        'title: 대화',
        'subtitle: Chat',
        'runtime: python',
        'runTimeout: 60',
        'panels: [completion, output]',
        'completion:',
        '  mode: mock',
        '  baseUrl: ""',
        '  model: classroom-mock-1',
        '  system: 너는 선생님이야',
        '  user: 안녕',
        'files:',
        '  main.py: |',
        '    print(1)',
        '---',
        '본문입니다.',
      ].join('\n'),
    );
    expect(lesson.runTimeoutMs).toBe(60_000);
    expect(lesson.completion).toEqual({
      mode: 'mock',
      baseUrl: '',
      model: 'classroom-mock-1',
      system: '너는 선생님이야',
      user: '안녕',
    });
  });

  it('rejects a completion panel without its section or with an unknown mode', () => {
    const base = (extra: string[]) =>
      [
        '---',
        'id: chat',
        'title: 대화',
        'subtitle: Chat',
        'runtime: python',
        'panels: [completion, output]',
        ...extra,
        'files:',
        '  main.py: |',
        '    print(1)',
        '---',
        '본문입니다.',
      ].join('\n');
    expect(() => parseLessonDoc(base([]))).toThrow(/needs a "completion" section/);
    expect(() =>
      parseLessonDoc(base(['completion:', '  mode: pretend', '  model: m'])),
    ).toThrow(/must be "mock" or "live"/);
  });

  it('rejects an unknown runtime and duplicate mission ids', () => {
    const lesson = (overrides: string[]) =>
      ['---', 'id: x', 'title: T', 'subtitle: S', 'runtime: python', 'files:', '  a.py: |', '    pass', ...overrides, '---', 'body'].join('\n');
    expect(() => parseLessonDoc(lesson(['runtime: sql']))).toThrow(/runtime must be one of/);
    expect(() =>
      parseLessonDoc(
        lesson([
          'missions:',
          '  - id: same',
          '    title: T',
          '    goal: G',
          '    hint: H',
          '    check:',
          '      type: ran',
          '  - id: same',
          '    title: T',
          '    goal: G',
          '    hint: H',
          '    check:',
          '      type: ran',
        ]),
      ),
    ).toThrow(/duplicate mission id/);
  });
});

describe('bundled lesson catalog', () => {
  it('ships the bundled lessons in order', () => {
    expect(LESSONS.map((lesson) => lesson.id)).toEqual(['python-hello', 'git-basics', 'chat-completion']);
    expect(lessonById('python-hello')?.runtime).toBe('python');
    expect(lessonById('git-basics')?.runtime).toBe('git');
    expect(lessonById('chat-completion')?.runtime).toBe('python');
  });

  it('declares the panel slots each runtime needs', () => {
    expect(lessonById('python-hello')?.panels).toEqual(['output']);
    expect(lessonById('git-basics')?.panels).toEqual(['git-graph', 'working-tree']);
    expect(lessonById('chat-completion')?.panels).toEqual(['completion', 'output']);
  });

  it('has bilingual copy, starting files and missions for every lesson', () => {
    for (const lesson of LESSONS) {
      expect(lesson.title.ko.length).toBeGreaterThan(0);
      expect(lesson.title.en.length).toBeGreaterThan(0);
      expect(lesson.subtitle.ko).not.toBe(lesson.subtitle.en);
      expect(lesson.entry in lesson.files).toBe(true);
      expect(lesson.missions.length).toBeGreaterThanOrEqual(4);
      for (const mission of lesson.missions) {
        expect(mission.title.ko).not.toBe('');
        expect(mission.title.en).not.toBe('');
        expect(mission.hint.ko.length).toBeGreaterThan(10);
      }
    }
  });

  it('keeps a python main.py and a git starting tree', () => {
    const python = lessonById('python-hello');
    expect(python?.files['main.py']).toContain('print(f"안녕하세요, {name}입니다.")');
    const git = lessonById('git-basics');
    expect(Object.keys(git?.files ?? {})).toEqual(expect.arrayContaining(['README.md', 'hello.txt', 'notes.md']));
  });

  it('takes the Git lesson from init to push in six missions', () => {
    const git = lessonById('git-basics');
    expect(git?.missions.map((mission) => mission.id)).toEqual([
      'git-init',
      'git-first-commit',
      'git-branch',
      'git-merge',
      'git-remote',
      'git-push',
    ]);
    expect(git?.missions.at(-1)?.check).toEqual({ type: 'git-push', remote: 'origin', branch: 'main' });
    expect(git?.missions[4].check).toEqual({ type: 'git-remote', name: 'origin' });
    // The starting README is the map the learner follows: it has to name the
    // remote and push steps, and say to merge from main.
    expect(git?.files['README.md']).toContain('git remote add origin');
    expect(git?.files['README.md']).toContain('git push -u origin main');
    expect(git?.files['README.md']).toContain('반드시 main 에서');
  });

  it('takes the chat completion lesson from settings to a three-turn chatbot', () => {
    const chat = lessonById('chat-completion');
    expect(chat?.missions.map((mission) => mission.id)).toEqual([
      'chat-settings',
      'chat-request',
      'chat-first-call',
      'chat-response',
      'chat-roles',
      'chat-parameters',
      'chat-stream',
      'chat-chatbot',
    ]);
    expect(chat?.completion).toEqual({
      mode: 'mock',
      baseUrl: '',
      model: 'classroom-mock-1',
      system: '너는 친절한 파이썬 선생님이야.',
      user: '안녕! 너는 누구야?',
    });
    expect(chat?.runTimeoutMs).toBe(60_000);
    expect(chat?.files['llm_client.py']).toContain('async def chat(');
    expect(chat?.files['llm_client.py']).toContain('async def stream_chat(');
    expect(chat?.files['main.py']).toContain('llm_client.mask_key()');
    expect(chat?.files['chatbot.py']).toContain('TODO');
  });

  it('ships a direct-HTTP practice file beside the helper', () => {
    const chat = lessonById('chat-completion');
    const direct = chat?.files['http_direct.py'] ?? '';
    // The learner writes endpoint, headers, payload, POST and parsing themselves.
    for (const todo of ['TODO 1', 'TODO 2', 'TODO 3', 'TODO 4', 'TODO 5']) {
      expect(direct).toContain(todo);
    }
    expect(direct).toContain('open_url');
    expect(direct).toContain('urllib');
    // The eight guided missions and the shell stay as they were.
    expect(chat?.missions).toHaveLength(8);
    expect(chat?.body).toContain('http_direct.py');
    expect(chat?.panels).toEqual(['completion', 'output']);
  });

  it('writes material with headings, a table and a code block', () => {
    for (const lesson of LESSONS) {
      expect(lesson.body).toMatch(/^##\s/m);
      expect(lesson.body).toMatch(/^\|\s*---/m);
      expect(lesson.body).toMatch(/^```/m);
    }
  });
});
