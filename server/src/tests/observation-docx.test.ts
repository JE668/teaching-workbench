import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { startServer, stopServer, req, createUser, url } from './helpers.js';
import { setObservationGenerator, resetObservationGenerator } from '../services/observation.js';
import { parseObservationReport } from '../utils/observationDocx.js';

const REPORT = [
  '【听课人评价】',
  '教学目标：目标明确，贴合课程标准。',
  '教学内容：重难点突出，容量适中。',
  '教学方法：启发引导，方法贴合学情。',
  '学生参与度与学习状态：学生主动回应，专注度高。',
  '教学过程：环节完整，过渡自然。',
  '教师素养：教态自然，语言清晰。',
  '教学效果：当堂掌握，目标达成。',
  '特色与创新：生活化导入，贴合兴趣。',
  '',
  '【综合评价与建议】',
  '一、本节课亮点：',
  '1. 导入用生活实例唤起兴趣。',
  '2. 板书清晰规范。',
  '二、有待优化的部分：',
  '1. 练习梯度偏单一。',
  '三、教学建议：',
  '1. 分层布置练习。',
  '四、总体评价等级：良好',
].join('\n');

describe('parseObservationReport（纯解析，容错）', () => {
  test('解析出 8 项 + 综合四块 + 等级', () => {
    const p = parseObservationReport(REPORT);
    assert.equal(p.items.length, 8);
    assert.match(p.items[0], /目标明确/);
    assert.match(p.items[7], /生活化导入/);
    assert.match(p.highlight, /导入用生活实例/);
    assert.match(p.optimize, /练习梯度偏单一/);
    assert.match(p.suggest, /分层布置练习/);
    assert.equal(p.grade, '良好');
    // 综合块不应混入下一项的编号
    assert.ok(!p.highlight.includes('二、'), 'highlight 尾部不得带下一项编号');
    assert.ok(!p.suggest.includes('四、'), 'suggest 尾部不得带下一项编号');
  });

  test('报告缺失/为空 → 全空不抛错', () => {
    const p = parseObservationReport('');
    assert.deepEqual(p.items, ['', '', '', '', '', '', '', '']);
    assert.equal(p.highlight, '');
    assert.equal(p.optimize, '');
    assert.equal(p.suggest, '');
    assert.equal(p.grade, '');
  });

  test('等级用半角冒号也能解析', () => {
    const p = parseObservationReport('【综合评价与建议】\n四、总体评价等级:合格');
    assert.equal(p.grade, '合格');
  });
});

describe('听评课 Word 导出（docx）', () => {
  let token = '';
  before(async () => {
    await startServer();
    token = await createUser('docx-听课人');
  });
  after(async () => {
    await stopServer();
  });

  test('生成报告后导出：内容已填入、无残留 {{ 占位符、合法 docx', async () => {
    resetObservationGenerator();
    setObservationGenerator(async () => REPORT);

    const t = await req('POST', '/api/teachers', { token, body: { name: '王丽' } });
    assert.equal(t.status, 200);
    const o = await req('POST', '/api/observations', {
      token,
      body: {
        teacherId: t.body.teacher.id,
        topic: '分数加减法运算',
        lessonType: 'new',
        observedAt: '2026-10-17',
        classNotes: '导入用生活实例引入分数加减法…',
      },
    });
    assert.equal(o.status, 200);
    const id = o.body.observation.id;

    const rep = await req('POST', `/api/observations/${id}/report`, { token, body: {} });
    assert.equal(rep.status, 200);

    const res = await fetch(url(`/api/observations/${id}/docx`), {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')!.includes('wordprocessingml'));
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 2).toString(), 'PK', '应为合法 docx(zip)');
    assert.ok(buf.length > 5000);

    const zip = await JSZip.loadAsync(buf);
    const xml = await (zip.file('word/document.xml') as any).async('string');
    assert.ok(!xml.includes('{{'), '不应残留 {{tag}} 占位符');
    assert.ok(xml.includes('王丽'), '老师姓名应填入');
    assert.ok(xml.includes('分数加减法运算'), '课题应填入');
    assert.ok(xml.includes('新授课'), '课型应填入');
    assert.ok(xml.includes('良好'), '等级应填入');
    assert.ok(xml.includes('docx-听课人'), '签名应为登录用户名');
    assert.ok(xml.includes('导入用生活实例'), '综合评价亮点应填入');
  });

  test('尚未生成报告 → 400', async () => {
    const o = await req('POST', '/api/observations', {
      token,
      body: { topic: '还没有报告', lessonType: 'review', classNotes: 'x' },
    });
    assert.equal(o.status, 200);
    const res = await fetch(url(`/api/observations/${o.body.observation.id}/docx`), {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(res.status, 400);
  });

  test('他人记录 → 404（数据隔离）', async () => {
    const o = await req('POST', '/api/observations', {
      token,
      body: { topic: '隔离校验', classNotes: 'x' },
    });
    const other = await createUser('docx-隔离-2');
    const res = await fetch(url(`/api/observations/${o.body.observation.id}/docx`), {
      headers: { Authorization: 'Bearer ' + other },
    });
    assert.equal(res.status, 404);
  });
});
