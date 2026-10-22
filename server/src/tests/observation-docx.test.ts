import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { startServer, stopServer, req, createUser, url } from './helpers.js';
import { setObservationGenerator, resetObservationGenerator } from '../services/observation.js';
import { parseObservationReport } from '../utils/observationDocx.js';
import fs from 'node:fs';
import path from 'node:path';

/** 未勾选的等级用不间断空格占位；zip 库会把它还原成字面 NBSP 字符 */
const NBSP = '\u00a0';

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

/**
 * 部署资产回归。
 *
 * 事故：Dockerfile 只 COPY 了 dist/，漏了 templates/ —— 本地和测试环境
 * 模板文件都在，所以上面所有测试都通过，只有线上容器 ENOENT、Word 导出 500。
 *
 * 这两个用例把「模板必须能被找到」变成可验证的事：
 *   1. 文件确实在仓库里，且不在 .dockerignore 的排除范围内
 *   2. 缺文件时抛的是可定位的错误（而不是裸 ENOENT 混进 500 堆栈）
 */
describe('Word 导出模板资产（部署回归）', () => {
  test('模板文件存在，且不会被 .dockerignore 排除', () => {
    const tpl = path.resolve('templates', 'observation-template.docx');
    assert.ok(fs.existsSync(tpl), '缺少 Word 模板文件：server/' + path.relative(process.cwd(), tpl));

    const dir = path.dirname(tpl);
    const ignore = path.resolve(process.cwd(), '.dockerignore');
    if (!fs.existsSync(ignore)) return;

    const patterns = fs
      .readFileSync(ignore, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    for (const p of patterns) {
      // .dockerignore 是 glob：目录名、或该目录下的所有文件，都会被排除
      const dirOnly = p.replace(/\/\*+$/, '');
      if (dirOnly && tpl.startsWith(dir + path.sep + dirOnly) || tpl.endsWith(dirOnly)) {
        assert.fail('.dockerignore 排除了模板所在目录：' + p + '（生产镜像将缺失模板，Word 导出 500）');
      }
    }
  });

  test('模板缺失时报错能直接定位原因', async () => {
    const docx = await import('../utils/observationDocx.js');
    const realExists = fs.existsSync;
    let calledWith = null as unknown as string;

    try {
      fs.existsSync = ((p: any) => {
        calledWith = String(p);
        return calledWith.endsWith('observation-template.docx') ? false : (realExists as any)(p);
      }) as any;

      await assert.rejects(
        () => docx.buildObservationDocx({
          teacher: '王老师', time: '', topic: '', type: '',
          evals: [], highlight: '', optimize: '', suggest: '', grade: '', signature: '',
        }),
        /Word 模板缺失/,
      );
    } finally {
      fs.existsSync = realExists as any;
    }

    assert.ok(String(calledWith).endsWith('templates' + path.sep + 'observation-template.docx'));
  });
});

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
    assert.ok(xml.includes('导入用生活实例'), '综合评价亮点应填入');

    // 等级是「勾选括号」而不是「本课评定等级：良好」这种尾巴行
    // 注意要剥掉 XML 标签再看：模板把这行文字拆成了两个 run，「（」和「）」不在同一个 run 里
    const plain = xml.replace(/<[^>]+>/g, '');
    assert.ok(plain.includes('良好（✓'), '命中的等级应勾选 ✓，例如 良好（✓）');
    assert.ok(plain.includes('优秀（' + NBSP + '）'), '未命中的等级保留空格');
    assert.ok(!plain.includes('本课评定等级'), '不应再出现「本课评定等级：xx」那行尾巴');

    // 签名紧跟在模板自带的「评课人签名：」后面，不是单独一行
    const signIdx = xml.indexOf('评课人签名：');
    assert.ok(signIdx >= 0, '模板里的「评课人签名：」应保留');
    assert.ok(xml.slice(signIdx, signIdx + 80).includes('docx-听课人'), '签名应写在评课人签名后面');

    // 听课时间格式：26.10.17
    assert.ok(xml.includes('26.10.17'), '听课时间格式应为 26.10.17');

    // 填入内容强制小五（9pt）
    const teacherRun = xml.match(/<w:r>[\s\S]*?<w:t[^>]*>王丽<\/w:t>[\s\S]*?<\/w:r>/);
    assert.ok(teacherRun, '应能找到填入老师姓名的 run');
    assert.match(teacherRun[0], /<w:sz w:val="18"\/>/, '填入内容字号应为小五（18 半点）');

    // 文件名：星火个性化教学听评课表 {MM.DD} {被听课老师}.docx（不是评课人签名）
    const cd = res.headers.get('content-disposition') || '';
    const m = cd.match(/filename\*=UTF-8''(.+)$/);
    const fname = decodeURIComponent(m ? m[1] : '');
    assert.equal(fname, '星火个性化教学听评课表 10.17 王丽.docx');
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

  /** 从 document.xml 里取出每个段落的纯文本 */
  function paragraphs(xml: string): string[] {
    const out: string[] = [];
    const re = /<w:p[\s>][\s\S]*?<\/w:p>/g;
    let m;
    while ((m = re.exec(xml))) {
      let text = '';
      const tre = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
      let t;
      while ((t = tre.exec(m[0]))) text += t[1];
      out.push(text);
    }
    return out;
  }

  async function makeAndExport(report: string): Promise<string> {
    resetObservationGenerator();
    setObservationGenerator(async () => report);
    const o = await req('POST', '/api/observations', {
      token,
      body: { topic: '格式校验', lessonType: 'new', observedAt: '2026-10-17', classNotes: 'x' },
    });
    assert.equal(o.status, 200);
    const rep = await req('POST', `/api/observations/${o.body.observation.id}/report`, { token, body: {} });
    assert.equal(rep.status, 200);
    const res = await fetch(url(`/api/observations/${o.body.observation.id}/docx`), {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(res.status, 200);
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    return (zip.file('word/document.xml') as any).async('string');
  }

  test('综合评价多点 → 每点一段，不挤在同一行', async () => {
    const xml = await makeAndExport(
      [
        '【综合评价与建议】',
        '一、本节课亮点：',
        '1. 导入用生活实例唤起兴趣。',
        '2. 板书清晰规范。',
        '3. 提问有梯度。',
        '二、有待优化的部分：',
        '1. 练习梯度偏单一。',
        '三、教学建议：',
        '1. 分层布置练习。',
        '2. 扩大提问面。',
        '四、总体评价等级：良好',
      ].join('\n'),
    );

    const paras = paragraphs(xml);
    // 同一块里的多个点必须落在不同段落
    assert.ok(!paras.some((p) => p.includes('导入用生活实例') && p.includes('板书清晰规范')));
    assert.ok(!paras.some((p) => p.includes('板书清晰规范') && p.includes('提问有梯度')));
    assert.ok(!paras.some((p) => p.includes('分层布置练习') && p.includes('扩大提问面')));
    // 每个点各自成段
    assert.equal(paras.filter((p) => p.trim() === '导入用生活实例唤起兴趣。').length, 1);
    assert.equal(paras.filter((p) => p.trim() === '扩大提问面。').length, 1);
    // 拆段时去掉原来的「1.」「2.」序号，避免排版上重复编号
    assert.ok(!paras.some((p) => /^1[.、]/.test(p.trim()) && p.includes('导入用生活实例')));
  });

  test('综合块为空 → 不生成多余文字', async () => {
    const xml = await makeAndExport('【综合评价与建议】\n四、总体评价等级：优秀');
    const paras = paragraphs(xml).map((p) => p.trim());
    // 没有一条段落是空 run 残留出来的占位符
    assert.ok(!paras.some((p) => p.includes('{{highlight}}') || p.includes('{{suggest}}')));
  });

  test('签名取自「设置」，没填则回落登录用户名', async () => {
    const pref = await req('PUT', '/api/auth/preferences', { token, body: { signature: '周江凌' } });
    assert.equal(pref.status, 200);
    assert.equal(pref.body.preferences.signature, '周江凌');

    const xml = await makeAndExport('【综合评价与建议】\n四、总体评价等级：良好');
    const signIdx = xml.indexOf('评课人签名：');
    assert.ok(xml.slice(signIdx, signIdx + 80).includes('周江凌'), '签名应取偏好设置里的值');

    // 清空后回落登录用户名
    await req('PUT', '/api/auth/preferences', { token, body: { signature: '' } });
    const xml2 = await makeAndExport('【综合评价与建议】\n四、总体评价等级：良好');
    const s2 = xml2.indexOf('评课人签名：');
    assert.ok(xml2.slice(s2, s2 + 80).includes('docx-听课人'), '签名为空时应回落登录用户名');

    // 超长签名截断到 20 字，避免溢出纸面
    const long = await req('PUT', '/api/auth/preferences', {
      token,
      body: { signature: '一二三四五六七八九十一二三四五六七八九十' + '十一二三四五六七八九十' },
    });
    assert.equal(long.body.preferences.signature.length, 20);
  });

  test('各等级各自勾选正确的括号', async () => {
    const cases: Array<[string, string, string]> = [
      ['优秀', '优秀（✓', '良好（' + NBSP + '）'],
      ['合格', '合格（✓', '优秀（' + NBSP + '）'],
      ['有待提高', '有待提高（✓', '良好（' + NBSP + '）'],
    ];
    for (const [grade, hit, miss] of cases) {
      const xml = await makeAndExport(`【综合评价与建议】\n四、总体评价等级：${grade}`);
      const xmlText = xml.replace(/<[^>]+>/g, '');
      assert.ok(xmlText.includes(hit), `${grade} 应勾选自己的括号`);
      assert.ok(xmlText.includes(miss), `${grade} 时其它括号保持空格`);
      // 四个括号里最多只有一个 ✓
      assert.equal((xmlText.match(/（✓）/g) || []).length, 1);
    }
  });

  test('等级缺失时四个括号都不勾（不误判）', async () => {
    const xml = await makeAndExport('【综合评价与建议】\n三、教学建议：继续优化。');
    const xmlText = xml.replace(/<[^>]+>/g, '');
    assert.equal((xmlText.match(/（✓）/g) || []).length, 0);
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
