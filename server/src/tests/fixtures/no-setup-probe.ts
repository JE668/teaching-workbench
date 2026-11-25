import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import os from 'node:os';
import { env } from '../../config/env.js';

// 故意不 import '../setup.js'：由 npm test 的全局 --import 提供隔离。
test('未手写 setup 的测试也只能使用临时数据目录', () => {
  const resolved = path.resolve(env.DATA_DIR);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(resolved).startsWith('tw-test-'));
});
