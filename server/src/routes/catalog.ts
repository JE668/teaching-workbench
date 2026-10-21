import { Router } from 'express';
import catalogImportRoutes from './catalogImport.js';
import catalogListRoutes from './catalogList.js';
import catalogMaintainRoutes from './catalogMaintain.js';
import { mapCourse } from './catalogList.js';

export { mapCourse };

/**
 * 全年课程体系目录。
 *
 * 老师自己维护两份 Excel（高中 / 小初），列布局 6 种、合并单元格、分区标题行都很多，
 * 手工搬运到工作台不现实。导入解析落在 `catalogImport.ts`，读接口与筛选在
 * `catalogList.ts`，去重 / 重置这类维护动作在 `catalogMaintain.ts`。
 *
 * 导入是可重复的：同一个文件重复上传不会重复灌库，按
 * (band, grade, subject, track, term, seq, content) 判重。
 *
 * 目录是**全局共享**的：内置课程目录随镜像灌库，老师自己导入的目录也所有人可见。
 * 所有读接口都不带 user_id 过滤；user_id 只留作「谁导入的」留痕。
 * 去重同样是跨账号的——两个人导入同一份文件，第二个人得到「全部重复」。
 */
const router = Router();

// 三个子路由按职责划分，互不冲突：
// - 读 / 筛选 / 导出 / 手改（GET /courses、/facets、/usage、/xlsx、PATCH /courses/:id、
//   POST /courses/suggest-stars）
// - 导入 / 导入历史 / 删除（POST /import、GET /imports、DELETE /imports/batch、/imports/:id）
// - 维护（POST /dedupe、/reset-to-builtin）
//
// 唯一需要注意的顺序在 catalogImport 内部：DELETE /imports/batch 必须排在
// DELETE /imports/:id 之前，否则 /imports/batch 会被当成 :id 吃掉。
router.use('/', catalogListRoutes);
router.use('/', catalogImportRoutes);
router.use('/', catalogMaintainRoutes);

export default router;
