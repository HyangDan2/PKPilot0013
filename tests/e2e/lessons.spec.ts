import { expect, test, type Page } from '@playwright/test';

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

test.describe('desktop 1440×900: landing → lesson IDE', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('lands on the catalog, enters both lessons, runs them and returns', async ({ page }, testInfo) => {
    const errors = collectErrors(page);

    await page.goto('./');
    await expect(page.getByTestId('landing')).toBeVisible();
    await expect(page.getByTestId('lesson-card-python-hello')).toBeVisible();
    await expect(page.getByTestId('lesson-card-git-basics')).toBeVisible();
    await expect(page.locator('.brand')).toContainText('CodePlayground');
    // the four old track tabs are gone
    await expect(page.locator('.track-tab')).toHaveCount(0);
    expect(await overflow(page)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('pk13-landing-1440.png'), fullPage: false });

    // ── Python Hello World ────────────────────────────────────────────────
    await page.getByTestId('lesson-card-python-hello').click();
    await expect(page.getByTestId('lesson-doc')).toContainText('Python Hello World');
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('code-area')).toBeVisible();
    await expect(page.getByTestId('term-input')).toBeVisible();
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(page.getByTestId('output-card')).toBeVisible();
    await expect(page.getByTestId('doc-table').first()).toBeVisible();
    expect(await overflow(page)).toBe(0);

    await page.getByTestId('run').click();
    await expect(page.getByTestId('py-stdout')).toContainText('안녕하세요, 학습자입니다', { timeout: 180_000 });
    await expect(page.getByTestId('mission-card')).toContainText('변수로 나를 소개하기');
    await page.screenshot({ path: testInfo.outputPath('pk13-pc-python.png'), fullPage: false });
    expect(await overflow(page)).toBe(0);

    // logo returns to the catalog
    await page.getByTestId('brand-home').click();
    await expect(page.getByTestId('landing')).toBeVisible();

    // ── Git basics ────────────────────────────────────────────────────────
    await page.getByTestId('lesson-card-git-basics').click();
    await expect(page.locator('[data-panel="git-graph"]')).toBeVisible();
    await expect(page.locator('[data-panel="working-tree"]')).toBeVisible();
    await expect(page.locator('[data-panel="output"]')).toHaveCount(0);
    await expect(page.getByTestId('lesson-doc')).toContainText('Git 기초');

    await run(page, 'git init');
    await expect(page.getByTestId('terminal')).toContainText('Initialized empty Git repository');
    await expect(page.locator('[data-panel="working-tree"]')).toContainText('hello.txt');
    await run(page, 'git add .');
    await run(page, 'git commit -m "첫 커밋"');
    await expect(page.locator('[data-panel="git-graph"]')).toContainText('첫 커밋');
    await expect(page.getByTestId('mission-card')).toContainText('브랜치 만들고 이동하기');
    await expect(page.getByTestId('mission-card')).toContainText('2/6');
    expect(await overflow(page)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('pk13-pc-git.png'), fullPage: false });

    // ── language + theme ──────────────────────────────────────────────────
    await page.getByTestId('lang-en').click();
    await expect(page.getByTestId('mission-card')).toContainText('Active mission');
    await expect(page.getByTestId('lesson-doc')).toContainText('Git Basics');
    await expect(page.locator('.mobile-tabs')).toBeHidden();
    await page.getByTestId('lang-ko').click();
    await expect(page.getByTestId('mission-card')).toContainText('진행 중인 미션');

    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await overflow(page)).toBe(0);
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // ── ⋮ menu also comes home ────────────────────────────────────────────
    await page.getByTestId('portal-menu').click();
    await page.getByTestId('menu-home').click();
    await expect(page.getByTestId('landing')).toBeVisible();
    expect(await overflow(page)).toBe(0);

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('makes a mock chat completion call and fills every panel tab', async ({ page }, testInfo) => {
    const errors = collectErrors(page);

    await page.goto('./');
    await expect(page.getByTestId('lesson-card-chat-completion')).toBeVisible();
    await page.getByTestId('lesson-card-chat-completion').click();
    await expect(page.getByTestId('lesson-doc')).toContainText('Chat Completion');
    await expect(page.getByTestId('completion-panel')).toBeVisible();
    await expect(page.getByTestId('completion-mode')).toHaveText('Mock Mode');
    // Mock Mode needs no key, so the key field stays disabled
    await expect(page.getByTestId('completion-api-key')).toBeDisabled();
    await expect(page.getByTestId('completion-model')).toHaveValue('classroom-mock-1');
    expect(await overflow(page)).toBe(0);

    const code = [
      'import asyncio',
      'import llm_client',
      '',
      'print("mode:", llm_client.MODE)',
      'request = llm_client.build_request(llm_client.default_messages(), temperature=0.7)',
      'print("url:", request["url"])',
      'reply = asyncio.run(llm_client.chat(llm_client.default_messages(), temperature=0.7))',
      'print("assistant:", reply["choices"][0]["message"]["content"])',
      'print("total_tokens:", reply["usage"]["total_tokens"])',
    ].join('\n');
    await page.getByTestId('code-area').fill(code);
    await page.getByTestId('run').click();

    await expect(page.getByTestId('py-stdout')).toContainText('mode: mock', { timeout: 180_000 });
    await expect(page.getByTestId('py-stdout')).toContainText('assistant: 선생님:');
    await expect(page.getByTestId('py-stdout')).toContainText('total_tokens:');

    await page.getByTestId('completion-tab-request').click();
    await expect(page.getByTestId('completion-request')).toContainText('"messages"');
    await expect(page.getByTestId('completion-request')).not.toContainText('sk-');

    await page.getByTestId('completion-tab-response').click();
    await expect(page.getByTestId('completion-response')).toContainText('finish_reason');

    await page.getByTestId('completion-tab-assistant').click();
    await expect(page.getByTestId('completion-assistant')).toContainText('classroom-mock-1');

    await page.getByTestId('completion-tab-usage').click();
    await expect(page.getByTestId('completion-usage')).toContainText('prompt_tokens');
    await expect(page.getByTestId('completion-usage')).toContainText('total_tokens');

    await page.getByTestId('completion-tab-stream').click();
    await expect(page.getByTestId('completion-stream')).toBeHidden();

    await page.screenshot({ path: testInfo.outputPath('pk13-pc-completion.png'), fullPage: false });
    expect(await overflow(page)).toBe(0);
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});

test.describe('mobile 390×844: catalog and the four tabs', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('opens a lesson and switches 강의·파일 / 에디터 / 터미널 / 결과 with zero overflow', async ({ page }, testInfo) => {
    const errors = collectErrors(page);

    await page.goto('./');
    await expect(page.getByTestId('landing')).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('pk13-landing-390.png'), fullPage: false });

    await page.getByTestId('lesson-card-python-hello').click();
    await expect(page.getByTestId('mtab-files')).toBeVisible();
    await expect(page.getByTestId('mission-banner')).toBeVisible();
    expect(await overflow(page)).toBe(0);

    await page.getByTestId('mtab-files').click();
    await expect(page.getByTestId('lesson-doc')).toBeVisible();
    await expect(page.getByTestId('doc-table').first()).toBeVisible();
    expect(await overflow(page)).toBe(0);

    await page.getByTestId('side-tab-files').click();
    await expect(page.getByTestId('file-main.py')).toBeVisible();
    expect(await overflow(page)).toBe(0);

    await page.getByTestId('mtab-editor').click();
    await expect(page.getByTestId('code-area')).toBeVisible();
    expect(await overflow(page)).toBe(0);

    await page.getByTestId('mtab-terminal').click();
    await expect(page.getByTestId('term-input')).toBeVisible();
    await run(page, 'ls');
    await expect(page.getByTestId('terminal')).toContainText('main.py');
    expect(await overflow(page)).toBe(0);

    await page.getByTestId('mtab-output').click();
    await expect(page.getByTestId('mission-card')).toBeVisible();
    await expect(page.getByTestId('output-card')).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('pk13-mobile-390.png'), fullPage: false });

    // back to the catalog from the mobile title bar
    await page.getByTestId('brand-home').click();
    await expect(page.getByTestId('landing')).toBeVisible();
    expect(await overflow(page)).toBe(0);

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('shows the chat completion panel on the output tab with zero overflow', async ({ page }, testInfo) => {
    const errors = collectErrors(page);

    await page.goto('./');
    await expect(page.getByTestId('lesson-card-chat-completion')).toBeVisible();
    await page.getByTestId('lesson-card-chat-completion').click();
    await expect(page.getByTestId('mtab-output')).toBeVisible();
    expect(await overflow(page)).toBe(0);

    await page.getByTestId('mtab-output').click();
    await expect(page.getByTestId('completion-panel')).toBeVisible();
    await expect(page.getByTestId('completion-mode')).toHaveText('Mock Mode');
    await expect(page.getByTestId('completion-model')).toHaveValue('classroom-mock-1');
    expect(await overflow(page)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('pk13-mobile-completion.png'), fullPage: false });

    await page.getByTestId('brand-home').click();
    await expect(page.getByTestId('landing')).toBeVisible();
    expect(await overflow(page)).toBe(0);

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
