/**
 * BI 配置表 CRUD 路由
 *
 * indicator_overrides：指标覆盖规则（替代 Excel 硬编码）
 * incentive_settings：分公司/校区激励目标比例
 */
import { Router } from 'express';
import { z } from 'zod';
import { biDb } from './db.js';
import { AuthenticatedRequest } from '../types/index.js';

const router = Router();

// ============ indicator_overrides ============

const overrideCreateSchema = z.object({
  scope: z.enum(['student', 'teacher', 'mentor', 'subject_group', 'learning_center']),
  key_type: z.string().min(1),
  key_value: z.string().min(1),
  indicator: z.string().min(1),
  override_value: z.string().min(1),
  reason: z.string().optional(),
  effective_from: z.string().optional(),
  effective_to: z.string().nullable().optional(),
});

const overrideUpdateSchema = overrideCreateSchema.partial();

/** 列表：支持按 scope/indicator 过滤 */
router.get('/indicator-overrides', (req: AuthenticatedRequest, res) => {
  const { scope, indicator } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (scope) { conditions.push('scope = ?'); params.push(scope); }
  if (indicator) { conditions.push('indicator = ?'); params.push(indicator); }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const rows = biDb.prepare(
    `SELECT * FROM indicator_overrides ${where} ORDER BY scope, indicator, key_value`
  ).all(...params);
  res.json({ overrides: rows });
});

/** 创建 */
router.post('/indicator-overrides', (req: AuthenticatedRequest, res) => {
  const parsed = overrideCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const d = parsed.data;
  const result = biDb.prepare(
    `INSERT INTO indicator_overrides
     (scope, key_type, key_value, indicator, override_value, reason, effective_from, effective_to, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(d.scope, d.key_type, d.key_value, d.indicator, d.override_value, d.reason ?? null, d.effective_from ?? null, d.effective_to ?? null, req.userId ?? null);
  const row = biDb.prepare('SELECT * FROM indicator_overrides WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ override: row });
});

/** 更新 */
router.patch('/indicator-overrides/:id', (req: AuthenticatedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: '无效 ID' });

  const parsed = overrideUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (fields.length === 0) return res.status(400).json({ error: '没有需要更新的字段' });

  const setClause = fields.map(([k]) => `${k} = ?`).join(', ');
  const values: unknown[] = fields.map(([, v]) => v);
  values.push(req.userId ?? null);
  values.push(id);

  biDb.prepare(
    `UPDATE indicator_overrides SET ${setClause}, updated_by = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(...values);

  const row = biDb.prepare('SELECT * FROM indicator_overrides WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  res.json({ override: row });
});

/** 删除 */
router.delete('/indicator-overrides/:id', (req: AuthenticatedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: '无效 ID' });
  const result = biDb.prepare('DELETE FROM indicator_overrides WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: '记录不存在' });
  res.json({ message: '已删除' });
});

// ============ incentive_settings ============

const incentiveCreateSchema = z.object({
  scope: z.enum(['branch_company', 'learning_center', 'mentor']),
  scope_value: z.string().min(1),
  target_rate: z.number().min(0).max(100),
  effective_from: z.string(),
  effective_to: z.string().nullable().optional(),
});

const incentiveUpdateSchema = incentiveCreateSchema.partial();

router.get('/incentive-settings', (req: AuthenticatedRequest, res) => {
  const { scope } = req.query;
  const where = scope ? 'WHERE scope = ?' : '';
  const params = scope ? [scope] : [];
  const rows = biDb.prepare(
    `SELECT * FROM incentive_settings ${where} ORDER BY scope, scope_value, effective_from DESC`
  ).all(...params);
  res.json({ settings: rows });
});

router.post('/incentive-settings', (req: AuthenticatedRequest, res) => {
  const parsed = incentiveCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const d = parsed.data;
  const result = biDb.prepare(
    'INSERT INTO incentive_settings (scope, scope_value, target_rate, effective_from, effective_to) VALUES (?, ?, ?, ?, ?)'
  ).run(d.scope, d.scope_value, d.target_rate, d.effective_from, d.effective_to ?? null);
  const row = biDb.prepare('SELECT * FROM incentive_settings WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ setting: row });
});

router.patch('/incentive-settings/:id', (req: AuthenticatedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: '无效 ID' });

  const parsed = incentiveUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (fields.length === 0) return res.status(400).json({ error: '没有需要更新的字段' });

  const setClause = fields.map(([k]) => `${k} = ?`).join(', ');
  const values: unknown[] = fields.map(([, v]) => v);
  values.push(id);

  biDb.prepare(
    `UPDATE incentive_settings SET ${setClause} WHERE id = ?`
  ).run(...values);

  const row = biDb.prepare('SELECT * FROM incentive_settings WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  res.json({ setting: row });
});

router.delete('/incentive-settings/:id', (req: AuthenticatedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: '无效 ID' });
  const result = biDb.prepare('DELETE FROM incentive_settings WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: '记录不存在' });
  res.json({ message: '已删除' });
});

export default router;
