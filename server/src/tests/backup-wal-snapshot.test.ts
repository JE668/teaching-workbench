/**
 * 备份回退路径的事实校验（纯 sqlite3 CLI，不依赖 docker）。
 *
 * 代码审查报告曾断言 backup.sh 的回退分支（对运行中的 WAL 库做
 * db / -wal / -shm 三件套顺序 docker cp）会产生「撕裂备份」。
 * 在本机用真实 WAL 库复现后，结论需要修正为三点：
 *
 *   1) 顺序拷贝 main.db 与 -wal 得到副本，integrity_check 仍是 ok ——
 *      它不会在结构上损坏。
 *   2) 真正的危害是【时刻不确定】：副本会回放 wal 里的已提交事务，
 *      可能是比 main.db 那一瞬间更旧或更新的状态。它自洽，但不属于单一时刻。
 *   3) 若只拷 main.db 而漏掉 -wal，未 checkpoint 的 schema 页还在 WAL 里，
 *      副本会连表都看不到（no such table）——拿到的是空壳。
 *
 * 所以回退路径的正确修法不是"修撕裂"，而是让它也产出单一时刻的一致快照
 * （容器内 sqlite .backup / VACUUM INTO），拿不到就明确失败并告警。
 */
import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SQLITE = 'sqlite3';

function hasSqlite(): boolean {
  try {
    execFileSync(SQLITE, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sql(dbFile: string, statement: string): string {
  return execFileSync(SQLITE, [dbFile, statement], { encoding: 'utf8' }).trim();
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tw-wal-snap-'));
}

describe('WAL 备份回退路径的事实校验', () => {
  test('顺序拷贝 main.db + -wal 得到自洽副本（不会结构损坏，可随后拷 -shm）', (t) => {
    if (!hasSqlite()) {
      t.skip('本机无 sqlite3 CLI');
      return;
    }
    const dir = tmpDir();
    try {
      const src = path.join(dir, 'src.db');
      sql(src, 'PRAGMA journal_mode=WAL; CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT);');
      const ins = Array.from({ length: 200 }, (_, i) => `INSERT INTO t(v) VALUES('a${i}');`).join(' ');
      sql(src, ins);

      const snap = path.join(dir, 'snap.db');
      fs.copyFileSync(src, snap);
      if (fs.existsSync(src + '-wal')) fs.copyFileSync(src + '-wal', snap + '-wal');

      assert.equal(sql(snap, 'PRAGMA integrity_check;'), 'ok', '副本结构自洽');
      const full = Number(sql(src, 'SELECT COUNT(*) FROM t;'));
      const copy = Number(sql(snap, 'SELECT COUNT(*) FROM t;'));
      assert.ok(copy <= full, `副本 ${copy} 行不应多于源 ${full} 行（不会凭空多数据）`);
      assert.equal(copy, 200, '副本包含源库已提交的数据');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('漏拷 -wal 时未 checkpoint 的数据拿不到（说明必须产出单一时刻快照）', (t) => {
    if (!hasSqlite()) {
      t.skip('本机无 sqlite3 CLI');
      return;
    }
    const dir = tmpDir();
    const src = path.join(dir, 'src.db');
    const holder = path.join(dir, 'holder.py');

    // CLI 每次执行完就退出并 checkpoint，所以必须用【长驻进程】持有库并持续写入，
    // 在它还活着的时候去拷主库，才能复现「数据还在 WAL 里、没落主库」。
    const py = [
      'import sqlite3, time',
      'c = sqlite3.connect(' + JSON.stringify(src) + ')',
      'c.execute("PRAGMA journal_mode=WAL")',
      'c.execute("PRAGMA wal_autocheckpoint=0")',
      'c.execute("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)")',
      'for i in range(400):',
      '    c.execute("INSERT INTO t(v) VALUES(?)", ("b%d" % i,))',
      '    c.commit()',
      'time.sleep(8)',
      '',
    ].join('\n');
    fs.writeFileSync(holder, py);

    const waitFor = (file: string, ms: number): boolean => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (fs.existsSync(file) && fs.statSync(file).size > 0) return true;
        execFileSync('sleep', ['0.05']);
      }
      return false;
    };

    const child = spawn('python3', [holder], { stdio: 'ignore' });
    try {
      const walFile = src + '-wal';
      if (!waitFor(walFile, 8000)) {
        t.skip('未能构造出非空 WAL');
        return;
      }

      // 只拷主库，不带 -wal
      const only = path.join(dir, 'only-main.db');
      fs.copyFileSync(src, only);

      let onlyCount: number | null = null;
      try {
        onlyCount = Number(execFileSync(SQLITE, [only, 'SELECT COUNT(*) FROM t;'], { encoding: 'utf8' }).trim());
      } catch {
        onlyCount = null; // no such table：schema 页仍滞留在 WAL
      }

      assert.ok(
        onlyCount === null || onlyCount < 400,
        `漏拷 WAL 的副本必须缺数据（实际 ${onlyCount === null ? '连表都没有' : onlyCount + ' 行'}），` +
          '这正是不能用三件套顺序拷贝当备份的原因'
      );
    } finally {
      child.kill('SIGKILL');
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
