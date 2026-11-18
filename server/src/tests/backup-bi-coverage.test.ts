/**
 * 备份/恢复脚本对 bi.db 的事实校验（纯文本 grep，不依赖 docker）。
 *
 * 背景：bi.db（BI 报表数据底座）与 teaching.db 同目录（env.DATA_DIR）。
 * backup.sh / restore.sh 原本只覆盖 teaching.db，bi.db 完全漏掉，
 * 报表上传/指标配置/映射表全丢。这两条用例钉住"必须出现"的关键调用，
 * 防止后续重构又把 bi.db 从备份路径里删掉。
 */
import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function repoRoot(): string {
  // server/src/tests/xxx.test.ts → 仓库根
  return path.resolve(__dirname, '..', '..', '..');
}

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

describe('backup.sh / restore.sh 覆盖 bi.db', () => {
  test('backup.sh 抽出 backup_one_db 函数，并显式调用 bi.db', () => {
    const c = readRepo('backup.sh');
    assert.match(c, /backup_one_db\(\) \{/, 'backup.sh 应定义 backup_one_db 函数');
    assert.match(c, /verify_one_db\(\) \{/, 'backup.sh 应定义 verify_one_db 函数');
    assert.match(c, /backup_one_db "teaching\.db"/, '应显式备份 teaching.db');
    assert.match(c, /backup_one_db "bi\.db"/, '应显式备份 bi.db');
    assert.match(c, /verify_one_db "\$DB_FILE"/, '应校验主库备份');
    assert.match(c, /verify_one_db "\$BI_DB_FILE"/, '应校验 BI 库备份');
    // 清理 glob 要能匹配 bi-*.db
    assert.match(c, /teaching-workbench-bi-\*\.db\*/, '清理逻辑应能匹配 bi-*.db');
    // 最终统计要分开报 BI 库数量
    assert.match(c, /BI_DB_COUNT=/, '最终统计应单独报 BI 库数量');
  });

  test('restore.sh 恢复 bi.db + 完整性校验', () => {
    const c = readRepo('scripts/restore.sh');
    assert.match(c, /teaching-workbench-bi-\*\.db/, '--list 应能列出 BI 库备份');
    assert.match(c, /BI_DB_FILE=.*teaching-workbench-bi-\$STAMP\.db/, '应定位同时间戳的 BI 备份');
    assert.match(c, /mv \/tmp\/restore-bi\.db \/app\/data\/bi\.db/, '应把备份写到 /app/data/bi.db');
    assert.match(c, /Database\('\/app\/data\/bi\.db'/, '应对 bi.db 跑 integrity_check');
    assert.match(c, /warn ".*没有 BI 库备份/, '无 bi 备份时应告警但不阻塞主库恢复');
  });
});
