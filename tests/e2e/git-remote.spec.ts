import { expect, test, type Page } from '@playwright/test';

/**
 * WO-18 · the Git lesson end to end: the learner follows the lesson's own README
 * from `git init` to `git push`, and the graph, the working-tree card and the
 * mission checklist all have to agree at every step.
 *
 * No network beyond the built bundle, so these cases run in CI (`@smoke`).
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

const append = async (page: Page, file: string, line: string) => {
  await page.getByTestId(`tab-${file}`).click();
  const area = page.getByTestId('code-area');
  const current = await area.inputValue();
  await area.fill(`${current.replace(/\n$/, '')}\n${line}\n`);
};

test.describe('WO-18 · the Git lesson reaches push', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('@smoke init → commit → branch → merge → remote → push, all six missions', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await page.getByTestId('lesson-card-git-basics').click();
    await expect(page.getByTestId('code-area')).toBeVisible();
    await expect(page.getByTestId('mission-banner')).toContainText('0/6');

    // 1–2: repository and first commit
    await run(page, 'git init');
    await append(page, 'hello.txt', '첫 커밋에 담는 한 줄');
    await run(page, 'git add .');
    await run(page, 'git commit -m "첫 커밋"');
    await expect(page.getByTestId('mission-banner')).toContainText('2/6');

    // 3–4: a branch with a commit of its own, touching notes.md
    await run(page, 'git switch -c feature');
    await append(page, 'notes.md', '- feature 브랜치에서 적은 메모');
    await run(page, 'git add .');
    await run(page, 'git commit -m "메모 추가"');
    await expect(page.getByTestId('mission-banner')).toContainText('3/6');

    // 5–6: back on main, a commit on another file, then the merge
    await run(page, 'git switch main');
    await append(page, 'README.md', 'main 쪽에서 적은 한 줄');
    await run(page, 'git add .');
    await run(page, 'git commit -m "README 정리"');
    await run(page, 'git merge feature');
    await expect(page.getByTestId('terminal')).toContainText("Merge made by the 'ort' strategy.");
    await expect(page.getByTestId('mission-banner')).toContainText('4/6');
    await expect(page.locator('[data-panel="git-graph"]')).toContainText("Merge branch 'feature'");

    // 7: the remote appears in the working-tree card as soon as it is added
    await run(page, 'git remote add origin https://github.com/learner/playground.git');
    await expect(page.getByTestId('remote-line')).toContainText('origin');
    await expect(page.getByTestId('remote-drift')).toContainText('업스트림 없음');
    await expect(page.getByTestId('mission-banner')).toContainText('5/6');

    // 8: push, then the remote branch and the synced state show up
    await run(page, 'git push -u origin main');
    await expect(page.getByTestId('terminal')).toContainText('* [new branch]');
    await expect(page.getByTestId('remote-chip-origin-main')).toBeVisible();
    await expect(page.getByTestId('remote-drift')).toContainText('원격과 동기화됨');
    await expect(page.getByTestId('mission-banner')).toContainText('6/6');
    await expect(page.getByTestId('mission-card')).toContainText('원격에 올리기');

    // A commit after the push turns the same line into "ahead", and pushing
    // again brings it back — the lesson's last hint, verified.
    await append(page, 'hello.txt', '푸시 뒤 한 줄');
    await run(page, 'git add .');
    await run(page, 'git commit -m "푸시 뒤 커밋"');
    await expect(page.getByTestId('remote-drift')).toContainText('↑1');
    await run(page, 'git push');
    await expect(page.getByTestId('remote-drift')).toContainText('원격과 동기화됨');
    await expect(page.getByTestId('mission-banner')).toContainText('6/6');

    expect(await overflow(page)).toBe(0);
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('@smoke a merge from the wrong branch explains itself instead of doing nothing', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await page.getByTestId('lesson-card-git-basics').click();
    await run(page, 'git init');
    await append(page, 'hello.txt', '한 줄');
    await run(page, 'git add .');
    await run(page, 'git commit -m "첫 커밋"');
    await run(page, 'git switch -c feature');
    await append(page, 'notes.md', '- 메모');
    await run(page, 'git add .');
    await run(page, 'git commit -m "메모 추가"');

    // Standing on feature: git has nothing to merge, and the terminal says how
    // to get out of it (the exact trap the lesson material now warns about).
    await run(page, 'git merge feature');
    await expect(page.getByTestId('terminal')).toContainText('Already up to date.');
    await expect(page.getByTestId('terminal')).toContainText('git switch main');
    await expect(page.getByTestId('mission-banner')).toContainText('3/6');

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});

test.describe('WO-18 · mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('@smoke the remote line and origin/main chip fit in 390px', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await page.getByTestId('lesson-card-git-basics').click();
    await page.getByTestId('mtab-terminal').click();
    const run = async (command: string) => {
      const input = page.getByTestId('term-input');
      await input.fill(command);
      await input.press('Enter');
    };
    await run('git init');
    await run('git add .');
    await run('git commit -m "첫 커밋"');
    await run('git remote add origin https://github.com/learner/playground.git');
    await run('git push -u origin main');

    await page.getByTestId('mtab-output').click();
    await expect(page.getByTestId('remote-line')).toContainText('origin');
    await expect(page.getByTestId('remote-drift')).toContainText('원격과 동기화됨');
    expect(await overflow(page)).toBe(0);

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
