import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, createUser } from './helpers.js';
import { db } from '../config/database.js';
import { saveOcrResults, getOcrText, ocrImage, ocrImages } from '../services/ocr.js';

/**
 * OCR 的「结果入库 / 读取」路径测试。
 *
 * 真实识别（worker + 语言数据）在 NODE_ENV=test 被 ocrImage 短路——CI 里 worker
 * 初始化会卡死整条测试链（见 ocr.ts 的注释）。这条短路不能是验证盲区：
 * AI 上下文注入实际消费的是 image_ocr 表的读写，这里用真函数、真库把它锁住。
 */

let userId = 0;

before(async () => {
  await startServer();
  await createUser('ocr-db-teacher');
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get('ocr-db-teacher') as { id: number };
  userId = row.id;
  if (!userId) throw new Error('测试用户未建出来');
});
after(async () => {
  await stopServer();
});

describe('OCR 结果入库与读取', () => {
  test('保存后可按路径读回，未入库的路径不出现在结果里', () => {
    saveOcrResults(userId, [
      { path: 'u1/2026-10/a.png', text: '  通分练习第12页  ' },
      { path: 'u1/2026-10/b.png', text: '' },
    ]);
    const got = getOcrText(userId, ['u1/2026-10/a.png', 'u1/2026-10/b.png', 'u1/2026-10/missing.png']);
    assert.deepEqual(Object.keys(got).sort(), ['u1/2026-10/a.png', 'u1/2026-10/b.png'], '未入库路径不应混进结果');
    assert.equal(got['u1/2026-10/a.png'], '  通分练习第12页  ', '文本原样存取（trim 由调用方负责）');
    assert.equal(got['u1/2026-10/b.png'], '');
  });

  test('同路径重复保存是覆盖而不是报错（重复上传同一张图）', () => {
    saveOcrResults(userId, [{ path: 'u1/c.png', text: '第一版' }]);
    saveOcrResults(userId, [{ path: 'u1/c.png', text: '第二版' }]);
    assert.equal(getOcrText(userId, ['u1/c.png'])['u1/c.png'], '第二版');
    const n = (db.prepare('SELECT COUNT(*) AS n FROM image_ocr WHERE user_id = ? AND image_path = ?').get(userId, 'u1/c.png') as { n: number }).n;
    assert.equal(n, 1, '主键冲突应走 UPSERT，不能插出第二行');
  });

  test('多用户隔离：读不到别人的 OCR 结果', () => {
    const otherId = (db.prepare('SELECT id FROM users WHERE username != ? LIMIT 1').get('ocr-db-teacher') as { id: number } | undefined)?.id
      ?? Number(db.prepare("INSERT INTO users (username, password, created_at) VALUES ('ocr-db-other', 'x', datetime('now','+8 hours'))").run().lastInsertRowid);
    saveOcrResults(otherId, [{ path: 'u1/2026-10/a.png', text: '别人的文本' }]);
    assert.equal(getOcrText(userId, ['u1/2026-10/a.png'])['u1/2026-10/a.png'], '  通分练习第12页  ');
    assert.equal(getOcrText(otherId, ['u1/2026-10/a.png'])['u1/2026-10/a.png'], '别人的文本');
  });

  test('空路径列表不查库、直接返回空对象', () => {
    assert.deepEqual(getOcrText(userId, []), {});
  });

  test('测试环境识别短路：ocrImage 返回空串且不启动 worker', async () => {
    // 这条断言保护的是 CI 本身：谁把这个短路删了，这里先红，而不是整条流水线再挂 15 分钟
    assert.equal(await ocrImage('/nonexistent/x.png'), '');
    const results = await ocrImages(['/nonexistent/a.png', '/nonexistent/b.png']);
    assert.deepEqual(results, [
      { path: '/nonexistent/a.png', text: '' },
      { path: '/nonexistent/b.png', text: '' },
    ]);
  });
});
