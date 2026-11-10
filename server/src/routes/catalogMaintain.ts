import { Router } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { env } from '../config/env.js';
import { db } from '../config/database.js';
import {
  dedupeCourseCatalog,
  resetCatalogToBuiltIn,
} from '../utils/catalogDedupe.js';

const router = Router();

/**
 * 目录维护操作的权限门。
 *
 * 这两个端点会重写/清空【全局共享】的 course_catalog 与 catalog_imports，
 * 并 repoint 所有用户的 report_items —— 影响面是全机构，不该对每个登录账号开放。
 * 系统没有 admin 角色体系，这里按最小侵入口径收敛：只有「首启管理员」
 * （DEFAULT_ADMIN_USER 对应的账号）可以调用；单教师自用部署不受影响，
 * 多教师部署下其他账号调用会得到 403。
 */
function requireFirstAdmin(req: AuthenticatedRequest, res: any): boolean {
  const userId = req.userId!;
  const row = db
    .prepare('SELECT username FROM users WHERE id = ?')
    .get(userId) as { username: string } | undefined;
  const isFirstAdmin = !!row && row.username === env.DEFAULT_ADMIN_USER;
  if (!isFirstAdmin) {
    res.status(403).json({ error: '目录维护操作仅限管理员账号' });
    return false;
  }
  return true;
}

/**
 * 合并重复课程（同一门课被灌进库里两次）。
 *
 * 启动时已经自动跑过一次并写 schema_migrations 留痕，这里再给一个手工入口：
 * 用户自己又导了一份跟内置重复的目录时，不用重启容器就能收敛。
 */
router.post('/dedupe', (req: AuthenticatedRequest, res) => {
  if (!requireFirstAdmin(req, res)) return;
  try {
    res.json(dedupeCourseCatalog({ force: true }));
  } catch (error: any) {
    res.status(500).json({ error: '清理重复课程失败', message: error.message });
  }
});

/**
 * 只保留系统内置的课程目录：账号自己导入的导入记录和课程整批清掉。
 *
 * 去重合不掉「导的是一套不一样的课表」——那种情况下目录只会越堆越多、去重永远
 * 收不拢。所以给一把更彻底的刀。删之前会把月度总结 / 课堂观察里指向被删课程
 * 的引用改指到内置同名课（有同名课才改指），已经写过的总结、观察不变孤儿。
 * 收尾会再跑一轮去重，内置那份内部的历史重复也顺手收掉。
 */
router.post('/reset-to-builtin', async (req: AuthenticatedRequest, res) => {
  if (!requireFirstAdmin(req, res)) return;
  try {
    res.json(await resetCatalogToBuiltIn());
  } catch (error: any) {
    res.status(500).json({ error: '清理已导入课程失败', message: error.message });
  }
});

export default router;
