import { test, expect } from '@playwright/test';
import { loginViaApi, getToken } from './helpers';

/**
 * 听评课 Word 导出文件名。
 *
 * 用户要求的格式：星火个性化教学听评课表 日期 被听课老师.docx
 * 例如：星火个性化教学听评课表 10.17 周江凌.docx
 *
 * 第三段是**被听课老师**的姓名，不是评课人签名（签名只写进 Word 正文表末的
 * 「评课人签名：」后面）。历史上这里取的是 settings 里的签名，导致导出文件名
 * 和约定不符。这条用例锁住整条链路：后端 Content-Disposition → 前端取服务器
 * 文件名 → 浏览器实际保存的文件名。
 *
 * 报告用非流式接口生成：流式那一路要等 SSE 流读完才落库，且经过 vite preview
 * 代理，用例里等「已生成」提示再点下载会撞上一个窗口期（点早了 400）。用例关心
 * 的是文件名，不是流式时序。
 */
test.describe('听评课 Word 导出文件名', () => {
  test('下载 Word 的文件名 = 星火个性化教学听评课表 {日期} {被听课老师}.docx', async ({ page }) => {
    await loginViaApi(page);
    const token = await getToken(page);
    const auth = { Authorization: 'Bearer ' + token };

    const t = await page.request.post('/api/teachers', { headers: auth, data: { name: '周江凌' } });
    expect(t.status(), await t.text()).toBe(200);
    const teacherId = (await t.json()).teacher.id;

    const o = await page.request.post('/api/observations', {
      headers: auth,
      data: {
        teacherId,
        topic: '分数加减法运算',
        lessonType: 'new',
        observedAt: '2026-10-17',
        classNotes: '用生活实例引入分数加减法，学生参与度不错',
      },
    });
    expect(o.status(), await o.text()).toBe(200);
    const id = (await o.json()).observation.id;

    // 生成报告（同步返回并落库）
    const rep = await page.request.post('/api/observations/' + id + '/report', { headers: auth, data: {} });
    expect(rep.status(), await rep.text()).toBe(200);
    expect(((await rep.json()) as any).report, '应生成非空报告').toBeTruthy();

    await page.goto('/observations/' + id);
    await expect(page.getByRole('button', { name: '下载 Word' })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '下载 Word' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('星火个性化教学听评课表 10.17 周江凌.docx');

    // 内容也得是真 docx（zip 魔数 PK），别只对了个名字
    const chunks: Buffer[] = [];
    for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
    const buf = Buffer.concat(chunks);
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    expect(buf.length).toBeGreaterThan(5000);
  });
});
