import { test, expect } from '@playwright/test';
import { loginViaApi, getToken } from './helpers';

/**
 * 设置页回归测试。
 *
 * 这两条对应用户真实反馈：
 *  1) 「模型名称依然不是下拉选项」—— 模型必须是 <select>，不能是手输框
 *  2) 「保存失败：认证令牌无效或已过期」—— 令牌失效时不能只丢一句
 *     无从下手的错误，而应清掉登录态并明确告知重新登录
 */
test.describe('设置页', () => {
  test('模型与思考等级都是下拉框（不是手输框）', async ({ page }) => {
    await loginViaApi(page);
    await page.goto('/settings');
    const model = page.getByLabel('模型', { exact: true });
    await expect(model).toBeVisible();
    expect(await model.evaluate((el) => el.tagName)).toBe('SELECT');

    // 内置目录里的默认模型必须可选（无 API Key 时用内置列表兜底，下拉照样出现）
    await expect(model.locator('option[value="sensenova-6.8-flash-lite"]')).toHaveCount(1);
    // 保留手填入口
    await expect(model.locator('option[value="__custom__"]')).toHaveCount(1);

    const effort = page.getByLabel('思考等级', { exact: true });
    await expect(effort).toBeVisible();
    expect(await effort.evaluate((el) => el.tagName)).toBe('SELECT');

    // 不应再出现"模型名称"手输框
    await expect(page.getByLabel('模型名称', { exact: true })).toHaveCount(0);
  });

  test('切换到"自定义模型…"后出现手输框，可返回下拉', async ({ page }) => {
    await loginViaApi(page);
    await page.goto('/settings');

    const model = page.getByLabel('模型', { exact: true });
    await expect(model).toBeVisible();

    await model.selectOption('__custom__');
    await expect(page.getByLabel('模型名称', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /返回下拉选择/ }).click();
    await expect(page.getByLabel('模型', { exact: true })).toBeVisible();
  });

  test('评课人签名：可填写、保存后跨会话保留', async ({ page }) => {
    await loginViaApi(page);

    // .e2e-data 在多次运行之间是复用的：先清空签名，否则第二次跑时
    // 输入值和已存值相同 → 保存按钮保持禁用 → 点击超时
    const token = await getToken(page);
    await page.request.put('/api/auth/preferences', {
      headers: { Authorization: 'Bearer ' + token },
      data: { signature: '' },
    });

    await page.goto('/settings');

    const input = page.getByLabel('评课人签名');
    await expect(input).toBeVisible();
    expect(await input.evaluate((el) => (el as HTMLInputElement).maxLength)).toBe(20);
    await expect(input).toHaveValue('');

    await input.fill('周江凌');
    await page.getByRole('button', { name: '保存签名' }).click();

    // 按钮的禁用态来自前端乐观更新，证明不了已落库 —— 直接查接口确认
    await expect
      .poll(
        async () => {
          const r = await page.request.get('/api/auth/preferences', {
            headers: { Authorization: 'Bearer ' + token },
          });
          return (await r.json()).preferences.signature;
        },
        { timeout: 5000 }
      )
      .toBe('周江凌');

    // 新开会话（重新注入登录态）再进设置页，签名仍在
    await page.evaluate(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    });
    await loginViaApi(page);
    await page.goto('/settings');
    await expect(page.getByLabel('评课人签名')).toHaveValue('周江凌');
  });

  test('令牌失效时自动跳回登录页并说明原因', async ({ page }) => {
    // 先访问一次，确保能写 localStorage
    await page.goto('/login');

    // 伪造失效令牌：签名不符/过期都会走同一条 401 处理路径
    await page.evaluate(() => {
      localStorage.setItem('token', 'invalid.token.value');
      localStorage.setItem('user', JSON.stringify({ id: 1, username: 'ghost' }));
    });

    await page.goto('/settings');

    // 关键：被送回登录页，而不是停在设置页报一句看不懂的错
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('登录已过期，请重新登录')).toBeVisible();

    // 本地登录态已被清理
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });

  test('一键清除已导入课程规划：确认框写清后果，确认后调接口', async ({ page }) => {
    await loginViaApi(page);
    await page.goto('/settings');

    await page.getByTestId('reset-catalog-to-builtin').click();
    await expect(page.getByText('清除已导入的课程规划？')).toBeVisible();
    await expect(page.getByText(/课时来源会被改指到内置同名课/)).toBeVisible();
    await expect(page.getByText(/不可撤销/)).toBeVisible();

    await page.getByRole('button', { name: '清除，只保留系统内置' }).click();
    await expect(page.getByText(/已清除 \d+ 条已导入课程/)).toBeVisible();

    // 断言前先说清口径：后端把 is_builtin 序列化成**布尔**（Number(x) === 1），
    // 不是数字 1，所以别写 `i.is_builtin === 1`——那永远为 false。
    const token = await getToken(page);
    const importsOf = async () => {
      const res = await page.request.get('/api/catalog/imports', {
        headers: { Authorization: 'Bearer ' + token },
      });
      return ((await res.json()) as any).imports as any[];
    };

    const after = await importsOf();
    expect(after.filter((i) => !i.is_builtin), '不该有任何非内置的导入记录').toEqual([]);
    // 至少有一份内置还在，避免「数组是空的」让上面那条空转通过
    expect(after.filter((i) => i.is_builtin).length).toBeGreaterThan(0);
  });

  test('切换 AI 服务商：接口地址立即跟随，配置独立保存，切回不丢', async ({ page }) => {
    await loginViaApi(page);
    await page.goto('/settings');

    // 设置按账号独立保存；本用例走默认登录账号，结束仍切回以免影响共享库里的后续生成用例
    const token = await getToken(page);
    const restoreProvider = async () => {
      await page.request.put('/api/settings', {
        headers: { Authorization: 'Bearer ' + token },
        data: { 'ai.provider': 'sensenova' },
      });
    };

    try {
      // 记下 SenseNova 当前的模型
      const modelSelect = page.getByLabel('模型', { exact: true });
      const sensenovaModel = await modelSelect.inputValue();

      // 切到 Gemini 转发代理：接口地址乐观更新为代理地址（不等网络往返），
      // Key 输入框的 label 跟着换
      await page.getByLabel('AI 服务商').selectOption('gemini-proxy');
      await expect(page.getByText('已切换 AI 服务商').first()).toBeVisible();
      const baseUrlInput = page.getByLabel('接口地址');
      await expect(baseUrlInput).toHaveValue(/gemmaproxy\.dpdns\.org/);
      const geminiKey = page.getByLabel('Gemini 代理 API Key');
      await expect(geminiKey).toBeVisible();

      // 写入代理的 Key 并保存（模型走默认 gemini-3.8-flash）
      await geminiKey.fill('e2e-gemini-key');
      await page.getByRole('button', { name: '保存 AI 设置' }).click();
      await expect(page.getByText('AI 设置已保存，下次生成立即生效')).toBeVisible();

      // 切回 SenseNova：接口地址立即变回官方地址，原模型还在，Key label 变回
      await page.getByLabel('AI 服务商').selectOption('sensenova');
      await expect(page.getByText('已切换 AI 服务商').first()).toBeVisible();
      await expect(baseUrlInput).toHaveValue(/token\.sensenova\.cn/);
      await expect(page.getByLabel('SenseNova API Key')).toBeVisible();
      await expect(page.getByLabel('模型', { exact: true })).toHaveValue(sensenovaModel);

      // 再切回 Gemini：接口地址跟着切，Key 显示已配置（独立保存住了）
      await page.getByLabel('AI 服务商').selectOption('gemini-proxy');
      await expect(baseUrlInput).toHaveValue(/gemmaproxy\.dpdns\.org/);
      await expect(page.getByText(/已配置/).first()).toBeVisible();
    } finally {
      await restoreProvider();
    }
  });
});
