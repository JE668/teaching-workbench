import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * 测试环境隔离。
 * 必须在导入 app/env 之前执行（测试文件里第一个 import）。
 * 每个测试文件由 node --test 在独立进程中运行，因此各自拥有独立的数据目录与数据库。
 */
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-test-'));

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = 'test-only-secret-do-not-use-in-production';
process.env.SENSENOVA_API_KEY = '';
process.env.DEFAULT_ADMIN_USER = 'admin';
process.env.DEFAULT_ADMIN_PASS = 'test-pass-123456';
// 关闭思考强度相关的重试干扰
process.env.SENSENOVA_REASONING_EFFORT = 'none';

export { TEST_DATA_DIR };
