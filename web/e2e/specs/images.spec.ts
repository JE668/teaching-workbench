import { test, expect, Page } from '@playwright/test';
import { getToken, loginViaApi, seedStudent } from './helpers';

/** 1x1 PNG */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** 通过 API 上传一张真实图片，返回相对路径 */
async function uploadImage(page: Page): Promise<string> {
  const token = await getToken(page);
  const res = await page.request.post('/api/upload', {
    headers: { Authorization: 'Bearer ' + token },
    multipart: {
      images: { name: 'homework.png', mimeType: 'image/png', buffer: TINY_PNG },
    },
  });
  expect(res.ok(), '上传失败: ' + res.status()).toBeTruthy();
  return (await res.json()).paths[0] as string;
}

async function seedFollowUpWithImage(page: Page, studentId: number, imagePath: string, topic: string) {
  const token = await getToken(page);
  const res = await page.request.post('/api/followups', {
    headers: { Authorization: 'Bearer ' + token },
    data: {
      studentId,
      studentName: '图片测试',
      grade: '小学五年级',
      subject: '数学',
      topic,
      performance: '专注',
      mastery: 'good',
      images: [imagePath],
      content: '【课堂内容】图片测试内容。',
    },
  });
  expect(res.ok(), '创建回访失败: ' + res.status()).toBeTruthy();
}

/**
 * 断言页面上至少有一张图片真正加载成功。
 * 注意：仅检查 <img> 存在是不够的 —— 路径错了它照样在 DOM 里，
 * 但 naturalWidth 会是 0。
 */
async function expectImageLoaded(page: Page, scope: ReturnType<Page['locator']> = page.locator('body')) {
  const img = scope.locator('img').last();
  await expect(img).toBeVisible();

  await expect
    .poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);
}

test.describe('图片链路', () => {
  test('上传后的图片可通过 /uploads 直接加载', async ({ page }) => {
    await loginViaApi(page);
    const path = await uploadImage(page);

    const res = await page.request.get('/uploads/' + path);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  });

  test('回访历史详情能真正加载出图片（回归：图片不可见）', async ({ page }) => {
    await loginViaApi(page);
    const studentId = await seedStudent(page, '图片测试');
    const path = await uploadImage(page);
    await seedFollowUpWithImage(page, studentId, path, '带图历史记录');

    await page.goto('/followups/history');
    await expect(page.getByRole('heading', { name: '回访历史' })).toBeVisible();

    // 打开该记录的详情
    await page.getByText('带图历史记录').first().click();
    await page.getByTitle('查看详情').first().click();
    await expect(page.getByRole('heading', { name: '回访详情' })).toBeVisible();
    await expect(page.getByText('课堂图片')).toBeVisible();

    const modal = page.getByRole('heading', { name: '回访详情' }).locator('xpath=ancestor::div[contains(@class,"relative")][1]');
    await expectImageLoaded(page, modal);
  });

  test('学生档案时间线能真正加载出图片', async ({ page }) => {
    await loginViaApi(page);
    const studentId = await seedStudent(page, '图片学生');
    const path = await uploadImage(page);
    await seedFollowUpWithImage(page, studentId, path, '档案带图记录');

    await page.goto('/students/' + studentId);
    await expect(page.getByText('档案带图记录')).toBeVisible();

    await expectImageLoaded(page);
  });

  /**
   * 回归：微信拖拽图片不生效
   *
   * macOS 微信拖拽出的 File 可能【没有 MIME 类型】，
   * 原实现按 `type.startsWith('image/')` 过滤会把它们全部丢掉，
   * 且因为直接 return 而毫无提示。
   */
  test('拖拽无 MIME 类型的图片也能上传（回归：微信拖拽失效）', async ({ page }) => {
    await loginViaApi(page);
    await page.goto('/followups');

    const b64 = TINY_PNG.toString('base64');

    await page.evaluate((base64) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const dt = new DataTransfer();
      // 关键：type 为空，模拟微信
      dt.items.add(new File([bytes], 'wechat-image', { type: '' }));

      const zone = document.querySelector('[data-testid="dropzone"]')!;
      zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, b64);

    await expect(page.getByText(/已上传 1 张图片/)).toBeVisible({ timeout: 15_000 });
    await expectImageLoaded(page);
  });

  test('拖拽确实无图时给出明确提示（不再静默失败）', async ({ page }) => {
    await loginViaApi(page);
    await page.goto('/followups');

    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '这不是图片');
      const zone = document.querySelector('[data-testid="dropzone"]')!;
      zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });

    await expect(page.getByText(/没有从拖拽中识别到图片/)).toBeVisible({ timeout: 10_000 });
  });

  test('本地上传（文件选择）后预览图能加载', async ({ page }) => {
    await loginViaApi(page);
    await page.goto('/followups');

    // 直接用文件选择器上传
    const input = page.locator('input[type="file"]');
    await input.setInputFiles({
      name: 'picked.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });

    await expect(page.getByText(/已上传 1 张图片/)).toBeVisible({ timeout: 15_000 });
    await expectImageLoaded(page);
  });
});
