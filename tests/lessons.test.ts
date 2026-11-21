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
  it('ships the two starter lessons in order', () => {
    expect(LESSONS.map((lesson) => lesson.id)).toEqual(['python-hello', 'git-basics']);
    expect(lessonById('python-hello')?.runtime).toBe('python');
    expect(lessonById('git-basics')?.runtime).toBe('git');
  });

  it('declares the panel slots each runtime needs', () => {
    expect(lessonById('python-hello')?.panels).toEqual(['output']);
    expect(lessonById('git-basics')?.panels).toEqual(['git-graph', 'working-tree']);
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

  it('writes material with headings, a table and a code block', () => {
    for (const lesson of LESSONS) {
      expect(lesson.body).toMatch(/^##\s/m);
      expect(lesson.body).toMatch(/^\|\s*---/m);
      expect(lesson.body).toMatch(/^```/m);
    }
  });
});
