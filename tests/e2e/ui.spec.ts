import { expect, test } from '@playwright/test';

test.describe('workspace behaviour', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('creates and deletes files, completes and recalls commands', async ({ page }) => {
    await page.goto('./');
    const input = page.getByTestId('term-input');

    // Tab completion on git subcommands
    await input.fill('git sw');
    await input.press('Tab');
    await expect(input).toHaveValue('git switch ');

    // history with the up arrow
    await input.fill('git init');
    await input.press('Enter');
    await input.press('ArrowUp');
    await expect(input).toHaveValue('git init');
    await input.press('Escape');

    // new file through the explorer
    await page.getByTestId('new-file').click();
    await page.locator('.file-row.editing input').fill('note.md');
    await page.locator('.file-row.editing input').press('Enter');
    await expect(page.getByTestId('file-note.md')).toBeVisible();
    await page.getByTestId('code-area').fill('# 노트\n\n- 첫 줄\n');
    await expect(page.getByTestId('tab-note.md')).toHaveAttribute('aria-selected', 'true');

    // the new file is part of the git working tree
    await input.fill('git status');
    await input.press('Enter');
    await expect(page.getByTestId('terminal')).toContainText('note.md');

    // hint toggles inside the mission card
    await expect(page.locator('.mission-hint')).toHaveCount(0);
    await page.getByRole('button', { name: '힌트 보기' }).click();
    await expect(page.locator('.mission-hint')).toBeVisible();
    await page.getByRole('button', { name: '힌트 숨기기' }).click();
    await expect(page.locator('.mission-hint')).toHaveCount(0);

    // free sandbox
    await page.getByTestId('mission-free').click();
    await expect(page.getByTestId('mission-card')).toContainText('자유 실습');
    await page.getByTestId('mission-git-init').click();
    await expect(page.getByTestId('mission-card')).toContainText('저장소 초기화');

    // delete a file (and keep one behind)
    await page.getByTestId('file-note.md').hover();
    await page.locator('.file-row.on .file-del').click();
    await expect(page.getByTestId('file-note.md')).toHaveCount(0);

    // reset this track
    await page.getByRole('button', { name: '이 트랙 다시 시작' }).click();
    await expect(page.locator('.mission-row.done')).toHaveCount(0);
    await expect(page.getByTestId('file-note.md')).toHaveCount(0);
  });

  test('keeps the four mobile tabs and quick chips usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('./');
    await page.getByTestId('mtab-terminal').click();
    await expect(page.locator('.term-chips')).toBeVisible();
    await page.locator('.term-chips .chip', { hasText: 'git status' }).click();
    await expect(page.getByTestId('term-input')).toHaveValue('git status');
    await page.getByTestId('term-input').press('Enter');
    await expect(page.getByTestId('terminal')).toContainText('not a git repository');

    await page.getByTestId('mtab-editor').click();
    await page.getByTestId('code-area').fill('const answer = 42;\n');
    await page.getByTestId('code-area').press('Control+Enter');
    await page.getByTestId('mtab-terminal').click();
    await expect(page.getByTestId('terminal')).toContainText('git status');
  });
});
