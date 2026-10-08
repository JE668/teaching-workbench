import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, url, createUser, createStudent, createFollowUp } from './helpers.js';
import { toMarkdown, toCsv, exportFilename } from '../services/export.js';

let token = '';

before(async () => {
  await startServer();
  token = await createUser('export-teacher');
});
after(async () => {
  await stopServer();
});

/** 直接以文本读取导出响应（不走 JSON 解析） */
async function fetchExport(path: string, tk = token) {
  const res = await fetch(url(path), { headers: tk ? { Authorization: 'Bearer ' + tk } : {} });
  return {
    status: res.status,
    contentType: res.headers.get('content-type') || '',
    disposition: res.headers.get('content-disposition') || '',
    text: await res.text(),
  };
}

describe('导出接口', () => {
  test('Markdown 导出包含档案头、统计与全部回访', async () => {
    const s = await createStudent(token, { name: '导出测试', phone: '13900139000', notes: '偏好鼓励式教学' });
    await createFollowUp(token, { studentId: s.id, studentName: '导出测试', topic: '第一节课', images: ['1/a.png'] });
    await createFollowUp(token, { studentId: s.id, studentName: '导出测试', topic: '第二节课' });

    const r = await fetchExport('/api/students/' + s.id + '/export');
    assert.equal(r.status, 200);
    assert.match(r.contentType, /text\/markdown/);
    assert.match(r.disposition, /attachment/);

    assert.match(r.text, /# 导出测试 · 学习档案/);
    assert.match(r.text, /\| 年级 \| 小学五年级 \|/);
    assert.match(r.text, /\| 联系电话 \| 13900139000 \|/);
    assert.match(r.text, /> \*\*学生备注\*\*：偏好鼓励式教学/);
    assert.match(r.text, /共 2 次回访/);
    assert.match(r.text, /归档图片 1 张/);
    assert.match(r.text, /## 1\. 第一节课/);
    assert.match(r.text, /## 2\. 第二节课/);
    // 回访正文应原样带出
    assert.match(r.text, /【课堂内容】/);
    assert.match(r.text, /【课后任务】/);
  });

  test('次数按时间正序排列（1 在前）', async () => {
    const s = await createStudent(token, { name: '排序测试' });
    await createFollowUp(token, { studentId: s.id, studentName: '排序测试', topic: 'A-先' });
    await createFollowUp(token, { studentId: s.id, studentName: '排序测试', topic: 'B-后' });

    const r = await fetchExport('/api/students/' + s.id + '/export');
    assert.ok(r.text.indexOf('## 1. A-先') < r.text.indexOf('## 2. B-后'), '导出应按时间正序编号');
  });

  test('无回访记录时给出占位说明', async () => {
    const s = await createStudent(token, { name: '空记录' });
    const r = await fetchExport('/api/students/' + s.id + '/export');
    assert.equal(r.status, 200);
    assert.match(r.text, /暂无回访记录/);
  });

  test('CSV 导出带 BOM 与表头，且转义正确', async () => {
    const s = await createStudent(token, { name: 'CSV测试' });
    // 内容含逗号与引号，用于验证转义
    await createFollowUp(token, {
      studentId: s.id,
      studentName: 'CSV测试',
      topic: '含,逗号',
      content: '他说"很好"，但是要加练。',
      images: ['1/x.png', '1/y.png'],
    });

    const r = await fetchExport('/api/students/' + s.id + '/export?format=csv');
    assert.equal(r.status, 200);
    assert.match(r.contentType, /text\/csv/);

    // 注意：Fetch 的 Response.text() 会按规范剥离 BOM，必须查原始字节
    const raw = await fetch(url('/api/students/' + s.id + '/export?format=csv'), {
      headers: { Authorization: 'Bearer ' + token },
    });
    const bytes = new Uint8Array(await raw.arrayBuffer());
    assert.deepEqual(
      [bytes[0], bytes[1], bytes[2]],
      [0xef, 0xbb, 0xbf],
      '应带 UTF-8 BOM 以便 Excel 正确识别中文'
    );

    assert.match(r.text, /学生姓名,年级,学科,课程主题/);
    assert.match(r.text, /"含,逗号"/, '含逗号的字段应被引号包裹');
    assert.match(r.text, /"他说""很好""，但是要加练。"/, '内部引号应翻倍转义');
    assert.match(r.text, /1\/x\.png \| 1\/y\.png/, '多张图片应用 " | " 合并展示');
    assert.match(r.text, /,2,1\/x\.png/, '图片数应为 2');
  });

  test('日期区间过滤生效', async () => {
    const s = await createStudent(token, { name: '区间测试' });
    await createFollowUp(token, { studentId: s.id, studentName: '区间测试', topic: '区间内' });

    const today = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const iso = today.getFullYear() + '-' + p(today.getMonth() + 1) + '-' + p(today.getDate());

    const inside = await fetchExport('/api/students/' + s.id + '/export?from=' + iso + '&to=' + iso);
    assert.match(inside.text, /区间内/);

    const future = await fetchExport('/api/students/' + s.id + '/export?from=2099-01-01');
    assert.match(future.text, /暂无回访记录/, '区间外应无记录');
  });

  test('非法 format 返回 400', async () => {
    const s = await createStudent(token, { name: '格式校验' });
    const r = await fetchExport('/api/students/' + s.id + '/export?format=pdf');
    assert.equal(r.status, 400);
  });

  test('导出他人的学生档案返回 404', async () => {
    const other = await createUser('export-other');
    const mine = await createStudent(token, { name: '不可导出' });

    const r = await fetchExport('/api/students/' + mine.id + '/export', other);
    assert.equal(r.status, 404);
  });

  test('未登录不能导出', async () => {
    const s = await createStudent(token, { name: '需要登录' });
    const r = await fetchExport('/api/students/' + s.id + '/export', '');
    assert.equal(r.status, 401);
  });
});

describe('导出格式化（单元）', () => {
  const student: any = {
    id: 7,
    userId: 1,
    name: '张三',
    grade: '初三',
    subject: '物理',
    phone: '13800138000',
    notes: undefined,
    createdAt: '2026-03-05 09:00:00',
    updatedAt: '2026-03-05 09:00:00',
  };

  const followups: any[] = [
    {
      id: 1,
      userId: 1,
      studentId: 7,
      studentName: '张三',
      grade: '初三',
      subject: '物理',
      topic: '浮力',
      performance: '理解到位',
      mastery: 'excellent',
      images: [],
      content: '【课堂内容】讲解了阿基米德原理。',
      wordCount: 12,
      createdAt: '2026-03-06 15:00:00',
      updatedAt: '2026-03-06 15:00:00',
    },
  ];

  test('Markdown 掌握程度转中文标签', () => {
    const md = toMarkdown(student, followups, { format: 'md', now: new Date(2026, 2, 10, 8, 30) });
    assert.match(md, /掌握程度\*\*：优秀/);
    assert.match(md, /导出时间 \| 2026-03-10 08:30/);
  });

  test('imageMode=none 时不输出图片区块', () => {
    const withImages = [{ ...followups[0], images: ['1/a.png'] }];
    const md = toMarkdown(student, withImages, { format: 'md', imageMode: 'none' });
    assert.ok(!md.includes('课堂图片'));
  });

  test('CSV 无回访时仅含表头', () => {
    const csv = toCsv(student, []);
    const lines = csv.replace('\uFEFF', '').trim().split('\r\n');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /学生姓名/);
  });

  test('文件名含 ASCII 回退与 UTF-8 中文名', () => {
    const name = exportFilename(student, 'csv', new Date(2026, 2, 10));
    assert.match(name, /^student-7-followups-20260310\.csv; filename\*=UTF-8''/);
    assert.ok(name.includes(encodeURIComponent('张三-学习档案-20260310.csv')));
  });
});
