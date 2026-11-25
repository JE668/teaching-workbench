import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TestDataIsolationOptions {
  /** 测试进程显式配置的数据目录；缺省时读取 process.env.DATA_DIR。 */
  dataDir?: string;
  /** 当前安装实例的正式开发/生产数据目录，测试中禁止写入。 */
  defaultDataDir: string;
  /** 单测可显式注入；运行时自动识别 Node 测试运行器及直接执行的测试文件。 */
  isTestRunner?: boolean;
  /** 直接执行测试文件时的入口；缺省读取 process.argv[1]。 */
  entryPath?: string;
  /** 单测可显式注入；运行时读取 NODE_ENV。 */
  nodeEnv?: string;
  /** 测试数据允许使用的根目录；缺省为操作系统临时目录。 */
  allowedTestRoot?: string;
}

/** 解析已存在的路径及其 symlink；不存在的末级目录逐级向上解析。 */
function canonicalPath(value: string): string {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    const parent = path.dirname(resolved);
    if (parent === resolved) return resolved;
    return path.join(canonicalPath(parent), path.basename(resolved));
  }
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function isDirectTestEntry(entryPath: string | undefined): boolean {
  if (!entryPath) return false;
  const normalized = entryPath.replace(/\\/g, '/');
  return /(^|\/)src\/tests\//.test(normalized)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized);
}

/**
 * Node 测试运行器下，配置模块在创建数据库或 JWT 密钥前强制检查数据目录。
 * 即使某个测试文件忘记第一个 import './setup.js'，也只会快速失败，
 * 不会打开、迁移或清空实例默认数据目录中的数据库。
 */
export function assertTestDataIsolation(options: TestDataIsolationOptions): void {
  const entryPath = Object.prototype.hasOwnProperty.call(options, 'entryPath')
    ? options.entryPath
    : process.argv[1];
  const isTestRunner = options.isTestRunner
    ?? (process.execArgv.includes('--test') || Boolean(process.env.NODE_TEST_CONTEXT) || isDirectTestEntry(entryPath));
  if (!isTestRunner) return;

  const nodeEnv = Object.prototype.hasOwnProperty.call(options, 'nodeEnv')
    ? options.nodeEnv
    : process.env.NODE_ENV;
  if (nodeEnv === 'production') {
    throw new Error('[TEST_ISOLATION] 测试进程不得使用 NODE_ENV=production。');
  }

  const configured = Object.prototype.hasOwnProperty.call(options, 'dataDir')
    ? options.dataDir
    : process.env.DATA_DIR;
  if (!configured) {
    throw new Error(
      '[TEST_ISOLATION] Node 测试必须设置独立 DATA_DIR；'
      + "请预加载 src/tests/setup.ts，禁止连接实例默认数据库。",
    );
  }

  const candidate = canonicalPath(configured);
  const defaultDir = canonicalPath(options.defaultDataDir);
  if (isWithin(defaultDir, candidate)) {
    throw new Error(
      `[TEST_ISOLATION] 测试 DATA_DIR 指向实例默认数据目录：${path.resolve(configured)}；`
      + '请改用操作系统临时目录。',
    );
  }

  const allowedRoot = canonicalPath(options.allowedTestRoot ?? os.tmpdir());
  if (!isWithin(allowedRoot, candidate) || !path.basename(candidate).startsWith('tw-test-')) {
    throw new Error(
      `[TEST_ISOLATION] 测试 DATA_DIR 必须位于操作系统临时目录且目录名以 tw-test- 开头：${allowedRoot}；`
      + `当前为 ${candidate}。`,
    );
  }
}
