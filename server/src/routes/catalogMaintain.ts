import { Router } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import {
  dedupeCourseCatalog,
  resetCatalogToBuiltIn,
} from '../migrations/catalogDedupe.js';

const router = Router();

/**
 * 合并重复课程（同一门课被灌进库里两次）。
 *
 * 启动时已经自动跑过一次并写 schema_migrations 留痕，这里再给一个手工入口：
 * 用户自己又导了一份跟内置重复的目录时，不用重启容器就能收敛。
 */
router.post('/dedupe', (_req: AuthenticatedRequest, res) => {
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
router.post('/reset-to-builtin', async (_req: AuthenticatedRequest, res) => {
  try {
    res.json(await resetCatalogToBuiltIn());
  } catch (error: any) {
    res.status(500).json({ error: '清理已导入课程失败', message: error.message });
  }
});

export default router;
