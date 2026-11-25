import './setup.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertTestDataIsolation } from '../config/testDataIsolation.js';

const serverRoot = path.resolve(import.meta.dirname, '../..');
const probe = path.join(serverRoot, 'src/tests/fixtures/no-setup-probe.ts');

function runProbe(withGlobalSetup: boolean, direct = false) {
  const args = ['--import', 'tsx'];
  if (withGlobalSetup) args.push('--import', './src/tests/setup.ts');
  if (!direct) args.push('--test');
  args.push(probe);
  const childEnv: NodeJS.ProcessEnv = { ...process.env, JWT_SECRET: 'test-only-secret' };
  delete childEnv.DATA_DIR;
  delete childEnv.NODE_ENV;
  delete childEnv.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, args, {
    cwd: serverRoot,
    env: childEnv,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

test('测试运行器缺少 DATA_DIR 时在打开数据库前失败', () => {
  assert.throws(
    () => assertTestDataIsolation({ defaultDataDir: '/instance/data', dataDir: undefined, isTestRunner: true }),
    /[TEST_ISOLATION].*DATA_DIR/,
  );
});

test('显式指向实例默认目录同样被拦截，非测试进程不受影响', () => {
  assert.throws(
    () => assertTestDataIsolation({ defaultDataDir: '/instance/data', dataDir: '/instance/data', isTestRunner: true, allowedTestRoot: '/tmp' }),
    /[TEST_ISOLATION].*默认数据目录/,
  );
  assert.doesNotThrow(
    () => assertTestDataIsolation({ defaultDataDir: '/instance/data', dataDir: '/instance/data', isTestRunner: false }),
  );
  assert.doesNotThrow(
    () => assertTestDataIsolation({ defaultDataDir: '/instance/data', dataDir: '/tmp/tw-test-isolated', isTestRunner: true, allowedTestRoot: '/tmp' }),
  );
});

test('直接执行 src/tests 文件也触发保护，生产环境和非临时目录均被拒绝', () => {
  assert.throws(
    () => assertTestDataIsolation({
      defaultDataDir: '/instance/data', dataDir: undefined, allowedTestRoot: '/tmp',
      entryPath: '/project/server/src/tests/renewalActions.test.ts',
    }),
    /TEST_ISOLATION/,
  );
  assert.throws(
    () => assertTestDataIsolation({
      defaultDataDir: '/instance/data', dataDir: '/tmp/tw-test-isolated', allowedTestRoot: '/tmp',
      isTestRunner: true, nodeEnv: 'production',
    }),
    /NODE_ENV=production/,
  );
  assert.throws(
    () => assertTestDataIsolation({
      defaultDataDir: '/instance/data', dataDir: '/var/lib/teaching-production', allowedTestRoot: '/tmp',
      isTestRunner: true,
    }),
    /临时目录/,
  );
});

test('真实 Node 子进程：--test 与直接执行漏写 setup 均被拦截，全局预加载正常运行', () => {
  for (const direct of [false, true]) {
    const unprotected = runProbe(false, direct);
    assert.notEqual(unprotected.status, 0, unprotected.stdout + unprotected.stderr);
    assert.match(unprotected.stdout + unprotected.stderr, /TEST_ISOLATION/);

    const isolated = runProbe(true, direct);
    assert.equal(isolated.status, 0, isolated.stdout + isolated.stderr);
    assert.match(isolated.stdout, /pass 1/);
    assert.doesNotMatch(isolated.stdout + isolated.stderr, /TEST_ISOLATION/);
  }
});
