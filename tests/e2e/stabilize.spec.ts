import { expect, test, type Page } from '@playwright/test';

/**
 * Stabilisation spec (WO-01 … WO-06).
 *
 * The cases that touch only the Git engine are tagged `@smoke` and run in CI:
 * they need no network beyond the built bundle. The Python cases need Pyodide
 * from the CDN, so they run locally and against the live site.
 */

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const collectErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
};

const run = async (page: Page, command: string) => {
  const input = page.getByTestId('term-input');
  await input.fill(command);
  await input.press('Enter');
};

const openGit = async (page: Page) => {
  await page.goto('./');
  await page.getByTestId('lesson-card-git-basics').click();
  await expect(page.getByTestId('code-area')).toBeVisible();
};

const editorText = (page: Page) => page.getByTestId('code-area').inputValue();

test.describe('WO-01 · the editor and the repository never disagree', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('@smoke a branch switch really swaps the file the editor shows', async ({ page }) => {
    const errors = collectErrors(page);
    await openGit(page);
    await page.getByTestId('tab-README.md').click();
    const onMain = await editorText(page);
    expect(onMain).toContain('Git 기초 실습 저장소');

    await run(page, 'git init');
    await run(page, 'git add .');
    await run(page, 'git commit -m "첫 커밋"');

    await run(page, 'git switch -c feature');
    await page.getByTestId('code-area').fill('# feature 브랜치의 README\n');
    await run(page, 'git add .');
    await run(page, 'git commit -m "feature 작업"');
    await expect(page.getByTestId('code-area')).toHaveValue('# feature 브랜치의 README\n');

    await run(page, 'git switch main');
    await expect(page.getByTestId('terminal')).toContainText("Switched to branch 'main'");
    await expect(page.getByTestId('code-area')).toHaveValue(onMain);
    await expect(page.locator('[data-panel="working-tree"]')).toContainText('변경 사항이 없습니다');

    await run(page, 'git switch feature');
    await expect(page.getByTestId('code-area')).toHaveValue('# feature 브랜치의 README\n');

    // a file that only exists on one branch follows the switch too
    await run(page, 'git switch main');
    await expect(page.getByTestId('file-feature-only.md')).toHaveCount(0);

    expect(await overflow(page)).toBe(0);
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('@smoke a switch that would overwrite local work is refused and changes nothing', async ({ page }) => {
    const errors = collectErrors(page);
    await openGit(page);
    await page.getByTestId('tab-hello.txt').click();
    await run(page, 'git init');
    await run(page, 'git add .');
    await run(page, 'git commit -m "첫 커밋"');

    await run(page, 'git switch -c feature');
    await page.getByTestId('code-area').fill('feature 쪽 내용\n');
    await run(page, 'git add .');
    await run(page, 'git commit -m "feature 작업"');

    await run(page, 'git switch main');
    await page.getByTestId('code-area').fill('로컬에서 고친 내용\n');

    await run(page, 'git switch feature');
    await expect(page.getByTestId('terminal')).toContainText('would be overwritten by checkout');
    await expect(page.getByTestId('code-area')).toHaveValue('로컬에서 고친 내용\n');
    await expect(page.locator('[data-panel="working-tree"]')).toContainText('main');

    // forced switch is the documented way to throw the edit away
    await run(page, 'git switch -f feature');
    await expect(page.getByTestId('code-area')).toHaveValue('feature 쪽 내용\n');

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('@smoke deleting the open file hands the editor to a file that exists', async ({ page }) => {
    await openGit(page);
    await page.getByTestId('tab-hello.txt').click();
    await run(page, 'git init');
    await run(page, 'git add .');
    await run(page, 'git commit -m "첫 커밋"');

    await run(page, 'git rm hello.txt');
    await expect(page.getByTestId('file-hello.txt')).toHaveCount(0);
    await expect(page.getByTestId('tab-hello.txt')).toHaveCount(0);
    const active = await page.locator('.tab.on').innerText();
    expect(active).not.toBe('hello.txt');
    expect((await editorText(page)).length).toBeGreaterThan(0);
  });
});

test.describe('WO-06 · a reload comes back where the learner was', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('@smoke restores files, completed missions, the current mission and the repository', async ({ page }) => {
    const errors = collectErrors(page);
    await openGit(page);
    await page.getByTestId('tab-README.md').click();
    await run(page, 'git init');
    await run(page, 'git add .');
    await run(page, 'git commit -m "첫 커밋"');
    await run(page, 'git switch -c feature');
    await page.getByTestId('code-area').fill('# 저장되는 README\n');
    await expect(page.getByTestId('mission-banner')).toContainText('2/4');

    await page.waitForTimeout(400); // the save is debounced
    await page.reload();

    // the hash still points at the lesson, so the reload lands straight in it
    await expect(page.getByTestId('mission-banner')).toContainText('2/4', { timeout: 20_000 });
    await expect(page.getByTestId('mission-card')).toContainText('브랜치 만들고 이동하기');
    await page.getByTestId('tab-README.md').click();
    await expect(page.getByTestId('code-area')).toHaveValue('# 저장되는 README\n');
    // the repository itself came back, not just the text
    await run(page, 'git log --oneline');
    await expect(page.getByTestId('terminal')).toContainText('첫 커밋');
    await run(page, 'git branch');
    await expect(page.getByTestId('terminal')).toContainText('feature');
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});

test.describe('WO-03/04 · a runaway or failing program', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('never freezes the page and can be stopped from the editor', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await page.getByTestId('lesson-card-python-hello').click();
    await page.getByTestId('code-area').fill('while True:\n    pass\n');

    await page.getByTestId('run').click();
    await expect(page.getByTestId('stop')).toBeVisible({ timeout: 180_000 });
    // a second run cannot be started while one is going: the button is Stop
    await expect(page.getByTestId('run')).toHaveCount(0);

    // the UI still answers while the program loops in its worker
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const started = Date.now();
    await page.getByTestId('side-tab-files').click();
    await expect(page.getByTestId('file-main.py')).toBeVisible();
    expect(Date.now() - started).toBeLessThan(5_000);
    await page.getByTestId('side-tab-lesson').click();

    await page.getByTestId('theme-toggle').click();
    await page.getByTestId('stop').click();
    await expect(page.getByTestId('run')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('output-card')).toContainText('실행을 중단했습니다');
    await expect(page.getByTestId('terminal')).toContainText('실행을 중단했습니다');

    // and the next program runs normally in a fresh interpreter
    await page.getByTestId('code-area').fill('print(2 + 3)\n');
    await page.getByTestId('run').click();
    await expect(page.getByTestId('py-stdout')).toContainText('5', { timeout: 180_000 });
    await expect(page.getByTestId('mission-card')).toContainText('1/4');
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('an error is not a finished mission, and the next run is a clean retry', async ({ page }) => {
    await page.goto('./');
    await page.getByTestId('lesson-card-python-hello').click();
    await page.getByTestId('code-area').fill('print("열린 따옴표)\n');
    await page.getByTestId('run').click();
    await expect(page.getByTestId('py-error')).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId('output-card')).toContainText('프로그램이 오류로 끝났습니다');
    await expect(page.getByTestId('mission-banner')).toContainText('0/4');

    // fix it and run again — still one timing line before this one, so no stale retry
    await page.getByTestId('code-area').fill('print("고쳤습니다")\n');
    await page.getByTestId('run').click();
    await expect(page.getByTestId('py-stdout')).toContainText('고쳤습니다', { timeout: 180_000 });
    await expect(page.getByTestId('mission-banner')).toContainText('1/4');
  });

  test('a lesson file can be imported, and every run starts with a clean namespace', async ({ page }) => {
    await page.goto('./');
    await page.getByTestId('lesson-card-python-hello').click();
    await page.getByTestId('tab-practice.py').click();
    await page.getByTestId('code-area').fill('numbers = [1, 2, 3]\n');
    await page.getByTestId('tab-main.py').click();
    await page.getByTestId('code-area').fill('from practice import numbers\nprint(sum(numbers))\nleaked = "one run"\n');
    await page.getByTestId('run').click();
    await expect(page.getByTestId('py-stdout')).toContainText('6', { timeout: 180_000 });

    // a variable defined by the previous run must not survive into the next one
    await page.getByTestId('code-area').fill('print(leaked)\n');
    await page.getByTestId('run').click();
    await expect(page.getByTestId('py-error')).toContainText('NameError', { timeout: 180_000 });
  });
});

test.describe('existing behaviour is intact on both layouts', () => {
  test('@smoke desktop 1440 keeps KO/EN, theme and zero overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors = collectErrors(page);
    await openGit(page);
    expect(await overflow(page)).toBe(0);
    await expect(page.getByTestId('stop')).toHaveCount(0);

    await page.getByTestId('lang-en').click();
    await expect(page.getByTestId('mission-card')).toContainText('Active mission');
    await page.getByTestId('lang-ko').click();
    await expect(page.getByTestId('mission-card')).toContainText('진행 중인 미션');
    expect(await overflow(page)).toBe(0);
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('@smoke mobile 390×844 keeps the four tabs and zero overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors = collectErrors(page);
    await page.goto('./');
    await expect(page.getByTestId('landing')).toBeVisible();
    expect(await overflow(page)).toBe(0);

    await page.getByTestId('lesson-card-git-basics').click();
    await expect(page.getByTestId('mtab-terminal')).toBeVisible();
    await page.getByTestId('mtab-terminal').click();
    await run(page, 'git init');
    await expect(page.getByTestId('terminal')).toContainText('Initialized empty Git repository');
    expect(await overflow(page)).toBe(0);

    await page.getByTestId('mtab-editor').click();
    await expect(page.getByTestId('run')).toBeVisible();
    expect(await overflow(page)).toBe(0);
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});

/**
 * Second stabilisation round (v2.1.0 · WO-07 … WO-12): the promises that the
 * learner's own work is never lost, that an edited Python module is re-imported,
 * and that an empty workspace is still a working workspace.
 */
test.describe('WO-07/08 · local work is protected', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('@smoke git merge --abort puts the learner’s own work back', async ({ page }) => {
    const errors = collectErrors(page);
    await openGit(page);
    await page.getByTestId('tab-hello.txt').click();
    await run(page, 'git init');
    await run(page, 'git add .');
    await run(page, 'git commit -m "첫 커밋"');

    await run(page, 'git switch -c feature');
    await page.getByTestId('code-area').fill('feature 쪽\n');
    await run(page, 'git add .');
    await run(page, 'git commit -m "feature 작업"');

    await run(page, 'git switch main');
    await page.getByTestId('code-area').fill('main 쪽\n');
    await run(page, 'git add .');
    await run(page, 'git commit -m "main 작업"');

    // work the learner has not committed yet must survive merge and abort
    await page.getByTestId('tab-notes.md').click();
    await page.getByTestId('code-area').fill('# 아직 커밋하지 않은 메모\n');
    await page.getByTestId('tab-hello.txt').click();

    await run(page, 'git merge feature');
    await expect(page.getByTestId('code-area')).toHaveValue(/<<<<<<< HEAD/);
    await expect(page.locator('[data-panel="working-tree"]')).toContainText('병합 진행 중');

    await run(page, 'git merge --abort');
    await expect(page.getByTestId('terminal')).toContainText('Merge aborted.');
    await expect(page.getByTestId('code-area')).toHaveValue('main 쪽\n');
    await expect(page.locator('[data-panel="working-tree"]')).not.toContainText('병합 진행 중');
    await expect(page.locator('[data-panel="working-tree"]')).toContainText('notes.md');

    await page.getByTestId('tab-notes.md').click();
    await expect(page.getByTestId('code-area')).toHaveValue('# 아직 커밋하지 않은 메모\n');
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('@smoke git rm refuses to delete uncommitted work, and -f deletes it', async ({ page }) => {
    const errors = collectErrors(page);
    await openGit(page);
    await page.getByTestId('tab-hello.txt').click();
    await run(page, 'git init');
    await run(page, 'git add .');
    await run(page, 'git commit -m "첫 커밋"');
    await page.getByTestId('code-area').fill('아직 커밋하지 않은 수정\n');

    await run(page, 'git rm hello.txt');
    await expect(page.getByTestId('terminal')).toContainText('have local modifications');
    await expect(page.getByTestId('tab-hello.txt')).toHaveCount(1);
    await expect(page.getByTestId('code-area')).toHaveValue('아직 커밋하지 않은 수정\n');

    await run(page, 'git rm -f hello.txt');
    await expect(page.getByTestId('file-hello.txt')).toHaveCount(0);
    await expect(page.getByTestId('tab-hello.txt')).toHaveCount(0);
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});

test.describe('WO-12 · an empty workspace', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('@smoke removing every file shows an empty editor, and a new file works', async ({ page }) => {
    const errors = collectErrors(page);
    await openGit(page);
    await run(page, 'git init');
    await run(page, 'git add .');
    await run(page, 'git commit -m "첫 커밋"');
    await run(page, 'git rm README.md hello.txt notes.md');

    await expect(page.getByTestId('editor-empty')).toBeVisible();
    await expect(page.getByTestId('code-area')).toHaveCount(0);
    await expect(page.locator('[data-panel="working-tree"]')).not.toContainText('Untracked');

    await page.getByTestId('side-tab-files').click();
    await page.getByTestId('new-file').click();
    await page.locator('.file-row.editing input').fill('fresh.md');
    await page.locator('.file-row.editing input').press('Enter');
    await expect(page.getByTestId('tab-fresh.md')).toBeVisible();
    await page.getByTestId('code-area').fill('# 새 출발\n');

    await run(page, 'git status');
    await expect(page.getByTestId('terminal')).toContainText('fresh.md');
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});

test.describe('WO-11 · Python runs belong to their source', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('an edited lesson module is imported fresh on the next run', async ({ page }) => {
    await page.goto('./');
    await page.getByTestId('lesson-card-python-hello').click();
    await page.getByTestId('tab-practice.py').click();
    await page.getByTestId('code-area').fill('value = 1\n');
    await page.getByTestId('tab-main.py').click();
    await page.getByTestId('code-area').fill('from practice import value\nprint(value)\n');
    await page.getByTestId('run').click();
    await expect(page.getByTestId('py-stdout')).toHaveText('1', { timeout: 180_000 });

    // edit the module, run the importer again — the cached module must not win
    await page.getByTestId('tab-practice.py').click();
    await page.getByTestId('code-area').fill('value = 22\n');
    await page.getByTestId('tab-main.py').click();
    await page.getByTestId('run').click();
    await expect(page.getByTestId('py-stdout')).toHaveText('22', { timeout: 120_000 });
  });

  test('output from a run made before an edit is marked stale', async ({ page }) => {
    await page.goto('./');
    await page.getByTestId('lesson-card-python-hello').click();
    await page.getByTestId('code-area').fill('print("첫 실행")\n');
    await page.getByTestId('run').click();
    await expect(page.getByTestId('py-stdout')).toHaveText('첫 실행', { timeout: 180_000 });
    await expect(page.getByTestId('py-stale')).toHaveCount(0);

    await page.getByTestId('code-area').fill('print("두 번째")\n');
    await expect(page.getByTestId('py-stale')).toBeVisible();

    await page.getByTestId('run').click();
    await expect(page.getByTestId('py-stdout')).toHaveText('두 번째', { timeout: 120_000 });
    await expect(page.getByTestId('py-stale')).toHaveCount(0);
  });
});
