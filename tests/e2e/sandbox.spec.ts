import { expect, test, type Page } from '@playwright/test';

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const run = async (page: Page, command: string) => {
  const input = page.getByTestId('term-input');
  await input.fill(command);
  await input.press('Enter');
};

test.describe('desktop 1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('boots, keeps zero horizontal overflow and runs all four tracks', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('./');
    await expect(page.getByTestId('terminal')).toBeVisible();
    await expect(page.locator('.brand')).toContainText('Vísna Sól');
    expect(await overflow(page)).toBe(0);

    // ── Git track ─────────────────────────────────────────────────────────
    await expect(page.getByTestId('mission-card')).toContainText('저장소 초기화');
    await run(page, 'git init');
    await expect(page.getByTestId('terminal')).toContainText('Initialized empty Git repository');
    await run(page, 'git add .');
    await run(page, 'git commit -m "첫 커밋"');
    await expect(page.getByTestId('terminal')).toContainText('첫 커밋');
    await expect(page.getByTestId('git-graph')).toBeVisible();
    await expect(page.getByTestId('mission-card')).toContainText('브랜치 만들고 이동하기');

    await run(page, 'git switch -c feature');
    await run(page, 'git log --oneline');
    await expect(page.getByTestId('terminal')).toContainText('HEAD -> feature');
    expect(await overflow(page)).toBe(0);

    // ── Python track ──────────────────────────────────────────────────────
    await page.getByTestId('track-python').click();
    await expect(page.getByTestId('mission-card')).toContainText('첫 파이썬 실행');
    await page.getByTestId('run').click();
    await expect(page.getByTestId('py-stdout')).toContainText('안녕하세요, 학습자입니다', { timeout: 180_000 });
    await expect(page.getByTestId('mission-card')).toContainText('f-문자열로 소개하기');

    const editor = page.getByTestId('code-area');
    await editor.fill('name = "Vísna Sól"\nprint(f"안녕하세요, {name}입니다.")');
    await page.getByTestId('run').click();
    await expect(page.getByTestId('py-stdout')).toContainText('안녕하세요, Vísna Sól입니다');

    // ── Linux track ───────────────────────────────────────────────────────
    await page.getByTestId('track-linux').click();
    await run(page, 'cat ~/logs/access.log | grep 404 | wc -l');
    await expect(page.locator('.term-line').last()).toHaveText('3');
    await run(page, 'mkdir practice');
    await run(page, 'touch practice/todo.txt');
    await run(page, 'echo "리눅스 연습" > practice/todo.txt');
    await expect(page.locator('.tree-row').filter({ hasText: 'practice' }).first()).toBeVisible();
    await expect(page.getByTestId('mission-linux-pipe')).toHaveClass(/done/);
    await expect(page.getByTestId('mission-linux-mkdir')).toHaveClass(/done/);
    expect(await overflow(page)).toBe(0);

    // ── SQL track ─────────────────────────────────────────────────────────
    await page.getByTestId('track-sql').click();
    await page.getByTestId('run').click();
    await expect(page.getByTestId('sql-table')).toBeVisible();
    await expect(page.getByTestId('sql-table')).toContainText('김하늘');
    await expect(page.locator('.schema-list')).toContainText('employees');
    expect(await overflow(page)).toBe(0);

    // ── language + theme ──────────────────────────────────────────────────
    await page.getByTestId('lang-en').click();
    await expect(page.locator('.mission-card')).toContainText('Active mission');
    await expect(page.locator('.mobile-tabs')).toBeHidden();
    await page.getByTestId('lang-ko').click();
    await expect(page.locator('.mission-card')).toContainText('진행 중인 미션');

    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.getByTestId('theme-toggle').click();
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(after).not.toBe(before);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await overflow(page)).toBe(0);
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // ── the 38px terminal line still fits the pane ────────────────────────
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);

    // let the completion toast clear so the capture shows the workspace itself
    await page.waitForTimeout(4200);
    await page.screenshot({ path: '/workspace/work/visna-sol-pc.png', fullPage: false });
  });

  test('renders the git graph after a real merge', async ({ page }) => {
    await page.goto('./');
    await run(page, 'git init');
    await run(page, 'git add .');
    await run(page, 'git commit -m "base"');
    await run(page, 'git switch -c feature');
    await page.getByTestId('tab-styles.css').click();
    await page.getByTestId('code-area').fill('.feature { color: #A78BFA; }\n');
    await run(page, 'git add .');
    await run(page, 'git commit -m "feature work"');
    await run(page, 'git switch main');
    await page.getByTestId('tab-app.js').click();
    await page.getByTestId('code-area').fill('export const main = true;\n');
    await run(page, 'git add .');
    await run(page, 'git commit -m "main work"');
    await run(page, 'git merge feature');
    await expect(page.getByTestId('terminal')).toContainText('Merge made by');
    await expect(page.getByTestId('git-graph')).toBeVisible();
    await expect(page.locator('.branch-chips')).toContainText('feature');
    await page.locator('.graph-wrap').screenshot({ path: '/workspace/work/visna-sol-git-graph.png' });
  });
});

test.describe('mobile 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('switches the four panels with zero horizontal overflow', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('./');
    expect(await overflow(page)).toBe(0);
    await expect(page.locator('.mission-banner')).toBeVisible();
    await expect(page.getByTestId('mtab-files')).toBeVisible();

    await page.getByTestId('mtab-files').click();
    await expect(page.getByTestId('sidebar')).toBeVisible();
    expect(await overflow(page)).toBe(0);

    await page.getByTestId('mtab-editor').click();
    await expect(page.getByTestId('code-area')).toBeVisible();
    await expect(page.getByTestId('terminal')).toBeHidden();

    await page.getByTestId('mtab-terminal').click();
    await expect(page.getByTestId('term-input')).toBeVisible();
    expect(await overflow(page)).toBe(0);

    await page.getByRole('button', { name: 'git status' }).click();
    await page.getByTestId('term-input').press('Enter');
    await expect(page.getByTestId('terminal')).toContainText('not a git repository');
    expect(await overflow(page)).toBe(0);

    await run(page, 'git init');
    await expect(page.getByTestId('terminal')).toContainText('Initialized');

    await page.getByTestId('mtab-output').click();
    await expect(page.locator('.mission-card')).toBeVisible();
    expect(await overflow(page)).toBe(0);

    await page.getByTestId('track-sql').click();
    await page.getByTestId('mtab-output').click();
    await expect(page.locator('.schema-list')).toContainText('employees', { timeout: 30_000 });
    expect(await overflow(page)).toBe(0);

    await page.getByTestId('mtab-terminal').click();
    await page.getByTestId('term-input').fill('SELECT name, salary FROM employees ORDER BY salary DESC LIMIT 3;');
    await page.getByTestId('term-input').press('Enter');
    await page.getByTestId('mtab-output').click();
    await expect(page.getByTestId('sql-table')).toContainText('김하늘');
    expect(await overflow(page)).toBe(0);

    expect(errors).toEqual([]);
    await page.waitForTimeout(4200);
    await page.screenshot({ path: '/workspace/work/visna-sol-mobile.png', fullPage: false });
  });
});
