import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { db } from '../config/database.js';
import { buildAllStudentProfiles } from '../services/ai/studentProfile.js';
import { log } from '../utils/logger.js';

export function parseProfileJobArgs(argv: string[]): number[] | undefined {
  const ids = new Set<number>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const raw = arg === '--user-id' ? argv[++i] : arg.startsWith('--user-id=') ? arg.slice('--user-id='.length) : undefined;
    if (raw === undefined) {
      if (arg.startsWith('--user-id')) throw new Error('--user-id 需要正整数用户 ID');
      throw new Error(`未知参数：${arg}`);
    }
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw new Error('--user-id 需要正整数用户 ID');
    ids.add(id);
  }
  return ids.size ? [...ids] : undefined;
}

/** 可由 cron 每日调用；用户之间互不阻断，单学生失败由 buildAllStudentProfiles 记录并继续。 */
export async function runProfileBuildJob(userIds?: number[]): Promise<{ users: number; students: number; succeeded: number; failed: number }> {
  const ids = userIds ?? (db.prepare('SELECT id FROM users ORDER BY id').all() as Array<{ id: number }>).map((row) => row.id);
  let students = 0;
  let succeeded = 0;
  let failed = 0;
  for (const userId of ids) {
    try {
      const results = await buildAllStudentProfiles(userId);
      students += results.length;
      succeeded += results.filter((result) => result.success).length;
      failed += results.filter((result) => !result.success).length;
    } catch (error: any) {
      failed += 1;
      log.error({ userId, error: error?.message }, '离线画像任务处理用户失败');
    }
  }
  return { users: ids.length, students, succeeded, failed };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const summary = await runProfileBuildJob(parseProfileJobArgs(process.argv.slice(2)));
    console.log(JSON.stringify(summary));
    if (summary.failed > 0) process.exitCode = 1;
  } catch (error: any) {
    console.error(error?.message || '离线画像任务失败');
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
