import { test, expect } from '@playwright/test';
import { loginViaApi, getToken } from './helpers';

/**
 * 听评课三种导出的文件名，统一为：星火个性化教学听评课表 日期 被听课老师
 * 例如：星火个性化教学听评课表 10.17 周江凌.docx / .txt / .png
 *
 * 第三段是**被听课老师**的姓名，不是评课人签名（签名只写进 Word 正文表末的
 * 「评课人签名：」后面），也不是课题。历史上有过两种偏差：docx 取的是签名，
 * txt / png 取的是「听评课_老师_课题」。三种格式都锁在这里。
 *
 * docx 走完整链路：后端 Content-Disposition → 前端取服务器文件名 → 浏览器
 * 实际保存的文件名。txt / png 由前端本地生成，直接断言浏览器保存名。
 *
 * 报告用非流式接口生成：流式那一路要等 SSE 流读完才落库，且经过 vite preview
 * 代理，用例里等「已生成」提示再点下载会撞上一个窗口期（点早了 400）。用例关心
 * 的是文件名，不是流式时序。
 */
const NAME = '星火个性化教学听评课表 10.17 周江凌';

test.describe('听评课导出文件名', () => {
  test('Word / 文本 / 图片卡片 都用「星火个性化教学听评课表 日期 被听课老师」', async ({ page }) => {
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
    const report = ((await rep.json()) as any).report as string;
    expect(report, '应生成非空报告').toBeTruthy();

    await page.goto('/observations/' + id);
    await expect(page.getByRole('button', { name: '下载 Word' })).toBeVisible();

    // —— Word：后端给的文件名 ——
    const [docx] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '下载 Word' }).click(),
    ]);
    expect(docx.suggestedFilename()).toBe(NAME + '.docx');
    // 内容也得是真 docx（zip 魔数 PK），别只对了个名字
    const docxChunks: Buffer[] = [];
    for await (const c of await docx.createReadStream()) docxChunks.push(c as Buffer);
    const docxBuf = Buffer.concat(docxChunks);
    expect(docxBuf.subarray(0, 2).toString()).toBe('PK');
    expect(docxBuf.length).toBeGreaterThan(5000);

    // —— 纯文本 ——
    const [txt] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '下载 .txt' }).click(),
    ]);
    expect(txt.suggestedFilename()).toBe(NAME + '.txt');
    const txtChunks: Buffer[] = [];
    for await (const c of await txt.createReadStream()) txtChunks.push(c as Buffer);
    expect(Buffer.concat(txtChunks).toString('utf-8')).toContain('【综合评价与建议】');

    // —— 图片卡片 ——
    const [png] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '图片卡片' }).click(),
    ]);
    expect(png.suggestedFilename()).toBe(NAME + '.png');
    const pngChunks: Buffer[] = [];
    for await (const c of await png.createReadStream()) pngChunks.push(c as Buffer);
    // PNG 文件头 89 50 4E 47 0D 0A 1A 0A
    expect(Buffer.concat(pngChunks).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  test('AI 生成后可以直接改字，保存后导出就是改过的版本', async ({ page }) => {
    await loginViaApi(page);
    const token = await getToken(page);
    const auth = { Authorization: 'Bearer ' + token };

    const o = await page.request.post('/api/observations', {
      headers: auth,
      data: { topic: '评课可编辑', lessonType: 'new', observedAt: '2026-10-17', classNotes: '导入通分讲解' },
    });
    expect(o.status(), await o.text()).toBe(200);
    const id = (await o.json()).observation.id;

    const rep = await page.request.post('/api/observations/' + id + '/report', { headers: auth, data: {} });
    expect(rep.status(), await rep.text()).toBe(200);
    const report = ((await rep.json()) as any).report as string;
    expect(report).toContain('【综合评价与建议】');

    await page.goto('/observations/' + id);
    // 报告正文就是那个装着报告内容的文本框
    const box = page.locator('textarea', { hasText: '【综合评价与建议】' });
    await expect(box).toBeVisible();

    // 听课人手工把亮点换成自己现场看到的那一句
    const edited = report.replace(
      '1. 用数轴和图形演示通分，把抽象的分数单位讲得直观可感。',
      '1. 老师用苹果分块演示通分，学生一眼看懂。'
    );
    expect(edited, '用例里的替换必须生效').not.toBe(report);
    await box.fill(edited);

    // 改了字之后出现「保存报告修改」，点完即消失
    const saveBtn = page.getByRole('button', { name: '保存报告修改' });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();
    await expect(saveBtn).toBeHidden();

    // 库里存的就是改后的正文
    const got = await page.request.get('/api/observations/' + id, { headers: auth });
    expect(got.status()).toBe(200);
    const saved = ((await got.json()) as any).observation.report as string;
    expect(saved).toContain('苹果分块演示通分');
    expect(saved).not.toContain('抽象的分数单位讲得直观可感');

    // 导出文本：改后的版本，不再有 AI 原文那句
    const [txt] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '下载 .txt' }).click(),
    ]);
    const txtChunks: Buffer[] = [];
    for await (const c of await txt.createReadStream()) txtChunks.push(c as Buffer);
    const txtBody = Buffer.concat(txtChunks).toString('utf-8');
    expect(txtBody).toContain('苹果分块演示通分');
    expect(txtBody).not.toContain('抽象的分数单位讲得直观可感');
  });
});
