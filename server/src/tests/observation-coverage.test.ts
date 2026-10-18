import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser } from './helpers.js';

let token = '';
let otherToken = '';

before(async () => {
  await startServer();
  token = await createUser('coverage-a');
  otherToken = await createUser('coverage-b');
});
after(async () => {
  await stopServer();
});

/** N 天前的本地日期字符串 */
function iso(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

async function makeTeacher(name: string, subject?: string) {
  const r = await req('POST', '/api/teachers', { token, body: { name, subject } });
  assert.equal(r.status, 200);
  return r.body.teacher.id as number;
}
async function makeObs(teacherId: number, daysAgo: number) {
  const r = await req('POST', '/api/observations', {
    token,
    body: { topic: 'T', teacherId, observedAt: iso(daysAgo) },
  });
  assert.equal(r.status, 200);
  return r.body.observation.id as number;
}

describe('听课覆盖率', () => {
  test('默认 90 天窗口：窗内/窗外分桶正确，coverage 口径一致', async () => {
    const inWin = await makeTeacher('覆盖率-王老师', '数学');
    await makeObs(inWin, 3);
    await makeObs(inWin, 10); // 窗内 2 节

    const outWin = await makeTeacher('覆盖率-李老师'); // 只有窗外的 1 节
    await makeObs(outWin, 200);

    const never = await makeTeacher('覆盖率-张老师'); // 完全没听过课

    const r = await req('GET', '/api/observations/coverage', { token });
    assert.equal(r.status, 200);

    assert.equal(r.body.window.days, 90, '不传 days 时默认 90 天');
    assert.equal(r.body.totalTeachers, 3);
    assert.equal(r.body.observedCount, 1);
    assert.equal(r.body.unobservedCount, 2);
    assert.ok(Math.abs(r.body.coverage - 1 / 3) < 1e-9);

    const [wang] = r.body.observed;
    assert.equal(wang.teacherId, inWin);
    assert.equal(wang.windowCount, 2);
    assert.equal(wang.lastObservedAt, iso(3));
    assert.equal(wang.daysSince, 3);

    const li = r.body.unobserved.find((x: any) => x.teacherId === outWin);
    assert.equal(li.windowCount, 0);
    // 窗内没听过，但「上次听课」仍给出全时段最后日期，方便判断该从谁补起
    assert.equal(li.lastObservedAt, iso(200));
    assert.equal(li.daysSince, 200);

    const zhang = r.body.unobserved.find((x: any) => x.teacherId === never);
    assert.equal(zhang.windowCount, 0);
    assert.equal(zhang.lastObservedAt, null);
    assert.equal(zhang.daysSince, null);
  });

  test('未听课名单把最该被听的排最前：从未听过 > 越久没听越靠前', async () => {
    const recent = await makeTeacher('覆盖率-刘老师');
    await makeObs(recent, 100);
    const older = await makeTeacher('覆盖率-陈老师');
    await makeObs(older, 300);
    const none = await makeTeacher('覆盖率-钱老师');

    const r = await req('GET', '/api/observations/coverage?days=90', { token });
    const ids = (r.body.unobserved as any[]).filter((x) =>
      [recent, older, none].includes(x.teacherId)
    ).map((x) => x.teacherId);

    assert.equal(ids[0], none, '从未听过课的排最前');
    assert.equal(ids[1], older, '其次是上次听课最久远的');
    assert.equal(ids[2], recent);
  });

  test('已听课名单按窗口内次数降序', async () => {
    const heavy = await makeTeacher('覆盖率-孙老师');
    await makeObs(heavy, 5);
    await makeObs(heavy, 6);
    await makeObs(heavy, 20);
    const light = await makeTeacher('覆盖率-周老师');
    await makeObs(light, 8);

    const r = await req('GET', '/api/observations/coverage?days=30', { token });
    const heavyRow = (r.body.observed as any[]).find((x) => x.teacherId === heavy);
    const lightRow = (r.body.observed as any[]).find((x) => x.teacherId === light);
    assert.equal(heavyRow.windowCount, 3);
    assert.equal(lightRow.windowCount, 1);
    assert.ok(
      (r.body.observed as any[]).indexOf(heavyRow) < (r.body.observed as any[]).indexOf(lightRow)
    );
  });

  test('缩短窗口：从「已听课」滑回「未听课」，但不丢历史', async () => {
    const t = await makeTeacher('覆盖率-吴老师');
    await makeObs(t, 15);   // 90 天窗内、10 天窗外
    await makeObs(t, 60);   // 90 天窗内
    await makeObs(t, 400);  // 全时段最早

    const wide = await req('GET', '/api/observations/coverage?days=90', { token });
    const wideRow = (wide.body.observed as any[]).find((x) => x.teacherId === t);
    assert.equal(wideRow.windowCount, 2);
    assert.equal(wideRow.lastObservedAt, iso(15));

    const narrow = await req('GET', '/api/observations/coverage?days=10', { token });
    const narrowRow = (narrow.body.unobserved as any[]).find((x) => x.teacherId === t);
    assert.ok(narrowRow, '10 天窗口内确实没有课');
    assert.equal(narrowRow.windowCount, 0);
    assert.equal(narrowRow.lastObservedAt, iso(15), '窗外名单也要能看出上次是哪天听的');
    assert.equal(narrowRow.daysSince, 15);
  });

  test('days 参数越界与非法值处理', async () => {
    const r1 = await req('GET', '/api/observations/coverage?days=999999', { token });
    assert.equal(r1.body.window.days, 3650, '上限 10 年');

    const r2 = await req('GET', '/api/observations/coverage?days=abc', { token });
    assert.equal(r2.body.window.days, 90, '非法值回退默认');

    const r3 = await req('GET', '/api/observations/coverage?days=-5', { token });
    assert.equal(r3.body.window.days, 90, '负数回退默认');

    const r4 = await req('GET', '/api/observations/coverage?days=1', { token });
    assert.equal(r4.body.window.days, 1);
    assert.equal(r4.body.window.from, r4.body.window.to, '1 天窗的起止是今天');
  });

  test('窗口是闭区间：边界当天这节课计入，差一天就不计入', async () => {
    const onEdge = await makeTeacher('覆盖率-郑老师');
    await makeObs(onEdge, 29); // 正好是 days=30 窗口的最后一天

    const inEdge = await req('GET', '/api/observations/coverage?days=30', { token });
    const inRow = (inEdge.body.observed as any[]).find((x) => x.teacherId === onEdge);
    assert.ok(inRow, '边界当天这节课应被计入');
    assert.equal(inRow.windowCount, 1);

    const outEdge = await req('GET', '/api/observations/coverage?days=29', { token });
    assert.ok(
      !(outEdge.body.observed as any[]).some((x) => x.teacherId === onEdge),
      '窗口收窄 1 天就该掉出去'
    );
  });

  test('数据隔离：他人老师与记录都不出现', async () => {
    const r = await req('GET', '/api/observations/coverage', { token: otherToken });
    assert.equal(r.status, 200);
    const names = [...r.body.observed, ...r.body.unobserved].map((x: any) => x.teacherName);
    assert.equal(r.body.totalTeachers, 0);
    assert.equal(names.length, 0);
  });

  test('空数据返回 0 而不是 NaN', async () => {
    const empty = await createUser('coverage-empty');
    const r = await req('GET', '/api/observations/coverage', { token: empty });
    assert.equal(r.status, 200);
    assert.equal(r.body.totalTeachers, 0);
    assert.equal(r.body.observedCount, 0);
    assert.equal(r.body.unobservedCount, 0);
    assert.equal(r.body.coverage, 0, '没有老师时覆盖率应为 0，不能是 NaN');
    assert.deepEqual(r.body.observed, []);
    assert.deepEqual(r.body.unobserved, []);
  });

  test('/coverage 不会被 /:id 吞掉', async () => {
    const r = await req('GET', '/api/observations/coverage', { token });
    assert.equal(r.status, 200, '必须命中 /coverage 而不是被当成 id 解析');
    assert.equal(typeof r.body.coverage, 'number');
  });
});
