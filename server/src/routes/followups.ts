import { Router } from 'express';
import readRouter from './followups.read.js';
import aiRouter from './followups.ai.js';
import writeRouter from './followups.write.js';

/**
 * 回访路由总入口。
 *
 * 按职责拆分为三个子路由：
 *  - read（列表 / 统计 / 历史建议 / 单条）
 *  - ai（SSE 流式生成）
 *  - write（创建 / 更新 / 删除）
 *
 * 挂载顺序有讲究：只读路由里的参数化路径 `GET /:id` 会把 `stats`、`suggestions`
 * 当成 id，但它俩都注册在 read 路由内部、且先于 `/:id`，所以没问题；
 * 跨路由之间方法不同（GET vs POST），互不干扰。
 */
const router = Router();

router.use(readRouter);
router.use(aiRouter);
router.use(writeRouter);

export default router;
