import { Router } from 'express';
import {
  SETTING_KEYS,
  getAllSettings,
  getOverrides,
  setSettings,
  bumpConfigVersion,
  maskSecret,
} from '../config/settings.js';

const router = Router();

/** 思考等级白名单（与 .env 校验保持一致） */
const EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high'];

/** 需要脱敏的键 */
const SECRET_KEYS = ['ai.apiKey'];

/**
 * 读取设置。
 * 密钥不回传明文，只给掩码 + 是否已配置，避免接口泄露。
 */
router.get('/', (_req, res) => {
  try {
    const effective = getAllSettings();

    const payload: Record<string, any> = { ...effective };
    for (const key of SECRET_KEYS) {
      payload[key] = {
        configured: !!effective[key],
        masked: maskSecret(effective[key]),
      };
    }

    res.json({
      settings: payload,
      /** 哪些项被显式覆盖过（未覆盖的走 .env） */
      overridden: Object.keys(getOverrides()),
      meta: {
        effortLevels: EFFORT_LEVELS,
        writableKeys: SETTING_KEYS,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: '读取设置失败', message: error.message });
  }
});

/** 更新设置（只接受白名单键） */
router.put('/', (req, res) => {
  try {
    const body = req.body || {};
    const patch: Record<string, string> = {};

    for (const key of SETTING_KEYS) {
      if (!(key in body)) continue;
      let value = body[key];

      // 密钥：传掩码或空 → 视为"不修改"，避免前端回显后把掩码写进去
      if (SECRET_KEYS.includes(key) && (value === '' || String(value).includes('••'))) {
        if (value === '') patch[key] = ''; // 显式清空
        continue;
      }

      value = String(value ?? '').trim();

      if (key === 'ai.reasoningEffort' && value && !EFFORT_LEVELS.includes(value)) {
        return res.status(400).json({ error: '不支持的思考等级: ' + value });
      }
      if (key === 'ai.timeoutMs' && value) {
        const ms = parseInt(value, 10);
        if (!Number.isFinite(ms) || ms < 5000 || ms > 300000) {
          return res.status(400).json({ error: '超时时间需在 5-300 秒之间' });
        }
      }
      if (key === 'ai.baseUrl' && value && !/^https?:\/\//.test(value)) {
        return res.status(400).json({ error: '接口地址需以 http(s):// 开头' });
      }
      if (key === 'ai.model' && value.length > 100) {
        return res.status(400).json({ error: '模型名过长' });
      }

      patch[key] = value;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: '没有需要更新的设置项' });
    }

    setSettings(patch);
    // 让 AI 客户端按新配置重建
    bumpConfigVersion();

    res.json({ success: true, updated: Object.keys(patch) });
  } catch (error: any) {
    res.status(500).json({ error: '保存设置失败', message: error.message });
  }
});

export default router;
