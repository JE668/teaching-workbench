import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser } from './helpers.js';

before(async () => {
  await startServer();
});

after(async () => {
  await stopServer();
});

let userSeq = 0;

/** 每个用例独立用户：分页断言依赖总数，共用用户会互相污染 */
async function freshUser(prefix: string): Promise<string> {
  userSeq += 1;
  return createUser(prefix + '-' + userSeq);
}

/** 造 n 条记录，observedAt 依次为 2026-03-01 .. 2026-03-31（最多 31 条） */
async function seed(token: string, n: number, extra: Record<string, any> = {}): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 1; i <= n; i += 1) {
    const day = String(i).padStart(2, '0');
    const r = await req('POST', '/api/observations', {
      token,
      body: { topic: 'T' + i, observedAt: '2026-03-' + day, ...extra },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    ids.push(r.body.observation.id);
  }
  return ids;
}

test('默认分页：只返回 20 条，并带 page/pageSize/total/totalPages', async () => {
  const token = await freshUser('obs-page-default');
  await seed(token, 25);

  const r = await req('GET', '/api/observations', { token });
  assert.equal(r.status, 200);
  assert.equal(r.body.observations.length, 20);
  assert.deepEqual(r.body.pagination, { page: 1, pageSize: 20, total: 25, totalPages: 2 });
});

test('翻页：第 2 页返回剩余 5 条，且与第 1 页不重叠', async () => {
  const token = await freshUser('obs-page-second');
  const ids = await seed(token, 25);

  const p1 = await req('GET', '/api/observations?page=1', { token });
  const p2 = await req('GET', '/api/observations?page=2', { token });
  const first = (p1.body.observations as any[]).map((o) => o.id);
  const second = (p2.body.observations as any[]).map((o) => o.id);

  assert.equal(second.length, 5);
  assert.equal(new Set(first.concat(second)).size, 25);
  assert.equal(new Set(first).size, 20);
  assert.deepEqual(second.sort((a, b) => a - b), ids.slice(0, 5).sort((a, b) => a - b));
});

test('排序：observed_at 倒序，未填日期的排在最后', async () => {
  const token = await freshUser('obs-page-order');
  const a = await req('POST', '/api/observations', { token, body: { topic: '早', observedAt: '2026-01-05' } });
  const b = await req('POST', '/api/observations', { token, body: { topic: '晚', observedAt: '2026-06-09' } });
  const c = await req('POST', '/api/observations', { token, body: { topic: '无日期' } });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(c.status, 200);

  const r = await req('GET', '/api/observations', { token });
  const order = (r.body.observations as any[]).map((o) => o.id);
  assert.deepEqual(order, [b.body.observation.id, a.body.observation.id, c.body.observation.id]);
});

test('pageSize 上限 100；非法值回落默认，page 非法回落 1', async () => {
  const token = await freshUser('obs-page-clamp');
  await seed(token, 25);

  const big = await req('GET', '/api/observations?pageSize=500', { token });
  assert.equal(big.body.pagination.pageSize, 100);
  assert.equal(big.body.observations.length, 25);

  const zero = await req('GET', '/api/observations?pageSize=0', { token });
  assert.equal(zero.body.pagination.pageSize, 20);

  const nan = await req('GET', '/api/observations?pageSize=abc&page=abc', { token });
  assert.equal(nan.body.pagination.pageSize, 20);
  assert.equal(nan.body.pagination.page, 1);

  const negative = await req('GET', '/api/observations?page=-3', { token });
  assert.equal(negative.body.pagination.page, 1);
});

test('超出末页返回空列表，但 total 仍为真实总数', async () => {
  const token = await freshUser('obs-page-beyond');
  await seed(token, 3);

  const r = await req('GET', '/api/observations?page=99', { token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.observations, []);
  assert.equal(r.body.pagination.total, 3);
  assert.equal(r.body.pagination.totalPages, 1);
});

test('课型过滤与分页组合：total 是过滤后的数量', async () => {
  const token = await freshUser('obs-page-filter');
  // 25 条 review + 5 条 new，total 应为 30，过滤 review 后应为 25
  const review = await seedWithType(token, 25, 'review', 1);
  const created = await seedWithType(token, 5, 'new', 26);
  assert.equal(review.length, 25);
  assert.equal(created.length, 5);

  const r = await req('GET', '/api/observations?lessonType=review&page=2&pageSize=10', { token });
  assert.equal(r.status, 200);
  assert.equal(r.body.observations.length, 10);
  assert.deepEqual(r.body.pagination, { page: 2, pageSize: 10, total: 25, totalPages: 3 });

  const all = await req('GET', '/api/observations', { token });
  assert.equal(all.body.pagination.total, 30);
});

/** 按课型造记录（日期取 2026-04-01 起，避开 31 天上限） */
async function seedWithType(token: string, n: number, lessonType: string, startDay: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const day = String(startDay + i).padStart(2, '0');
    const r = await req('POST', '/api/observations', {
      token,
      body: { topic: lessonType + '-' + i, lessonType, observedAt: '2026-04-' + day },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    ids.push(r.body.observation.id);
  }
  return ids;
}

test('时间过滤：to 当天包含在内，且可和分页叠加', async () => {
  const token = await freshUser('obs-page-range');
  for (const d of ['2026-05-09', '2026-05-10', '2026-05-11']) {
    const r = await req('POST', '/api/observations', { token, body: { topic: d, observedAt: d } });
    assert.equal(r.status, 200);
  }

  const day = await req('GET', '/api/observations?from=2026-05-10&to=2026-05-10', { token });
  assert.equal(day.body.pagination.total, 1);
  assert.equal(day.body.observations[0].observedAt, '2026-05-10');

  const span = await req('GET', '/api/observations?from=2026-05-10&to=2026-05-11&pageSize=1&page=2', { token });
  assert.equal(span.body.pagination.total, 2);
  assert.equal(span.body.pagination.totalPages, 2);
  assert.equal(span.body.observations.length, 1);
  assert.equal(span.body.observations[0].observedAt, '2026-05-10');
});

test('用户隔离：看不到别人的记录，total 也不含别人的', async () => {
  const mine = await freshUser('obs-page-mine');
  const other = await freshUser('obs-page-other');
  await seed(mine, 7);

  const r = await req('GET', '/api/observations', { token: other });
  assert.equal(r.status, 200);
  assert.equal(r.body.observations.length, 0);
  assert.equal(r.body.pagination.total, 0);
  assert.equal(r.body.pagination.totalPages, 1);
});
