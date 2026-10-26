import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { suggestMasteryStars, setStarGenerator, resetStarGenerator } from '../services/catalogStar.js';
import { STAR_BATCH_SIZE } from '../utils/catalogStar.js';
import type { StarCourseInput, StarDecision } from '../utils/catalogStar.js';

after(() => {
  resetStarGenerator();
});

/** 造 n 门课 */
function courses(n: number): StarCourseInput[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    content: '课程' + (i + 1),
    type: '专题',
    score: '7~10',
    difficulty: '★★★★',
    impact: '★★★★',
  }));
}

/** 生成器：按顺序返回预制的模型输出 */
function script(steps: string[]) {
  let i = 0;
  const calls: string[] = [];
  const fn = async (_userId: number, prompt: string) => {
    calls.push(prompt);
    return steps[Math.min(i++, steps.length - 1)];
  };
  return { fn, calls };
}

describe('suggestMasteryStars 分批定档', () => {
  test('空列表直接返回，不请求模型', async () => {
    const s = script(['{"results":[]}']);
    setStarGenerator(s.fn);
    const batches: StarDecision[][] = [];
    const r = await suggestMasteryStars(1, [], (_batch, _total, decisions) => {
      batches.push(decisions);
    });
    assert.equal(r.total, 0);
    assert.equal(r.batches, 0);
    assert.equal(r.updated, 0);
    assert.ok(r.model, '仍应返回模型名');
    assert.equal(batches.length, 0);
    assert.equal(s.calls.length, 0, '不应调用模型');
  });

  test('每 ' + STAR_BATCH_SIZE + ' 门一批，逐批回调', async () => {
    const n = STAR_BATCH_SIZE + 37;
    const steps = Array.from({ length: 2 }, (_, i) => {
      const start = i * STAR_BATCH_SIZE + 1;
      const end = Math.min(start + STAR_BATCH_SIZE - 1, n);
      const items = Array.from({ length: end - start + 1 }, (_, k) => ({ id: start + k, star: 3 }));
      return JSON.stringify({ results: items });
    });
    const s = script(steps);
    setStarGenerator(s.fn);

    const seen: StarDecision[][] = [];
    const r = await suggestMasteryStars(1, courses(n), (_batch, _totalBatches, decisions) => {
      seen.push(decisions);
    });

    assert.equal(s.calls.length, 2, '应发两次请求');
    assert.equal(seen.length, 2);
    assert.equal(seen[0].length, STAR_BATCH_SIZE);
    assert.equal(seen[1].length, 37);
    assert.equal(r.total, n);
    assert.equal(r.batches, 2);
    assert.equal(r.updated, n);
    // 第一批的决策都是本批的 id
    assert.ok(seen[0].every((d) => d.id >= 1 && d.id <= STAR_BATCH_SIZE));
    assert.ok(seen[1].every((d) => d.id > STAR_BATCH_SIZE));
  });

  test('超出本批的 id 会被丢弃', async () => {
    setStarGenerator(async (_userId: number) =>
      JSON.stringify({ results: [{ id: 1, star: 3 }, { id: 99999, star: 5 }, { id: 2, star: 1 }] })
    );
    const seen: StarDecision[][] = [];
    const r = await suggestMasteryStars(1, courses(2), (_b, _t, decisions) => seen.push(decisions));
    assert.deepEqual(seen[0], [
      { id: 1, star: 3 },
      { id: 2, star: 1 },
    ]);
    assert.equal(r.updated, 2);
  });

  test('模型返回脏数据时不报错，本批计 0', async () => {
    setStarGenerator(async (_userId: number) => '抱歉，我无法完成这个任务');
    const seen: StarDecision[][] = [];
    const r = await suggestMasteryStars(1, courses(3), (_b, _t, decisions) => seen.push(decisions));
    assert.equal(r.batches, 1);
    assert.equal(r.updated, 0);
    assert.deepEqual(seen[0], []);
  });

  test('模型抛错时翻译成中文并带上批次号', async () => {
    setStarGenerator(async (_userId: number) => {
      const err = new Error('request timed out');
      Object.assign(err, { name: 'APIConnectionTimeoutError' });
      throw err;
    });
    const r = suggestMasteryStars(1, courses(2), () => undefined);
    await assert.rejects(r, (e: any) => {
      assert.match(e.message, /超时/);
      assert.equal(e.batch, 1);
      return true;
    });
  });

  test('第 2 批失败时批次号正确', async () => {
    let calls = 0;
    setStarGenerator(async (_userId: number) => {
      calls++;
      if (calls === 2) throw new Error('boom');
      const start = (calls - 1) * STAR_BATCH_SIZE + 1;
      const items = Array.from({ length: STAR_BATCH_SIZE }, (_, k) => ({ id: start + k, star: 3 }));
      return JSON.stringify({ results: items });
    });
    await assert.rejects(suggestMasteryStars(1, courses(STAR_BATCH_SIZE * 2), () => undefined), (e: any) => {
      assert.equal(e.batch, 2);
      return true;
    });
  });

  test('提示词带上适用范围的年级 / 学科 / 学期', async () => {
    const s = script(['{"results":[{"id":1,"star":4}]}']);
    setStarGenerator(s.fn);
    await suggestMasteryStars(1, courses(1), () => undefined, { grade: '初二', subject: '物理', term: '秋季' });
    assert.match(s.calls[0], /年级=初二/);
    assert.match(s.calls[0], /学科=物理/);
    assert.match(s.calls[0], /学期=秋季/);
  });
});
