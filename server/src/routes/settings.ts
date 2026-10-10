import { Router } from 'express';
import {
  SETTING_KEYS,
  getAllSettings,
  getOverrides,
  setSettings,
  bumpConfigVersion,
  maskSecret,
  getAiConfig,
} from '../config/settings.js';

const router = Router();

/**
 * 内置的已知模型（兜底用）。
 * 运行时会优先调 SenseNova 的 /v1/models 实时拉取 —— 平台会不断上新模型，
 * 硬编码列表很快就过时，所以这里只放文档里确认存在的两个。
 */
export interface ModelMeta {
  id: string;
  name: string;
  description: string;
  /** 是否支持读取图片（我们上传作业照片，这点直接决定模型可用性） */
  vision: boolean;
  /** 该模型支持的思考等级（来自官方文档，各模型不一致） */
  efforts: string[];
}

/**
 * 内置模型目录 —— 依据官方《SenseNova AI API 文档》的"模型总览"整理。
 *
 * 排序即推荐顺序：能读图的模型排前面（本项目要把作业照片发给模型），
 * 图片创作类模型放最后并明确标注"不适用"。
 */
const MODEL_META: ModelMeta[] = [
  {
    id: 'sensenova-6.8-flash-lite',
    name: 'SenseNova 6.8 Flash Lite',
    description: '轻量多模态智能体 · 速度快（默认）',
    vision: true,
    efforts: ['none', 'low', 'medium', 'high', 'max'],
  },
  {
    id: 'deepseek-flash',
    name: 'DeepSeek V4.1 Flash',
    description: '高效通用 · 支持多模态理解',
    vision: true,
    efforts: ['none', 'low', 'medium', 'high', 'max'],
  },
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    description: '原生多模态 Agent · 1M 上下文',
    vision: true,
    efforts: ['none', 'low', 'medium', 'high', 'max'],
  },
  {
    id: 'glm-5.2',
    name: 'GLM-5.2',
    description: '智谱旗舰 · 长程 Coding 与复杂工程（不支持读图）',
    vision: false,
    efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: '高效经济型通用模型（不支持读图）',
    vision: false,
    efforts: ['none', 'low', 'medium', 'high', 'max'],
  },
  {
    id: 'sensenova-u1.5-lite',
    name: 'SenseNova U1.5 Lite',
    description: '图片创作模型 —— 不适用于回访生成',
    vision: false,
    efforts: ['none', 'high'],
  },
  {
    id: 'sensenova-u1.5-fast',
    name: 'SenseNova U1.5 Fast',
    description: '图片创作模型加速版 —— 不适用于回访生成',
    vision: false,
    efforts: ['none', 'high'],
  },
];

const META_BY_ID = new Map(MODEL_META.map((m) => [m.id, m]));

/** 未知模型的兜底元数据（接口实时返回了文档没收录的新模型时使用） */
function metaForUnknown(id: string): ModelMeta {
  return {
    id,
    name: id,
    description: '平台返回的模型',
    vision: true,
    efforts: ['none', 'low', 'medium', 'high', 'max'],
  };
}

function toOption(m: ModelMeta) {
  return {
    id: m.id,
    label: m.name + '（' + m.description + '）',
    name: m.name,
    description: m.description,
    vision: m.vision,
    efforts: m.efforts,
  };
}

const BUILTIN_MODELS = MODEL_META.map(toOption);

/** 查询上游模型列表的超时：设置页不该因为上游卡住而打不开 */
const MODELS_FETCH_TIMEOUT_MS = 8000;

/**
 * 拉取当前 API Key 可用的模型列表。
 * 优先走 OpenAI 兼容的 GET /models；失败时回落到内置列表，
 * 并在响应里如实标注来源与错误信息，方便前端提示。
 */
async function fetchAvailableModels(): Promise<{
  models: { id: string; label: string }[];
  source: 'api' | 'builtin';
  error?: string;
  current?: string;
}> {
  const config = getAiConfig();

  if (config.apiKey && config.baseUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODELS_FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(config.baseUrl.replace(/\/$/, '') + '/models', {
        headers: { Authorization: 'Bearer ' + config.apiKey },
        signal: controller.signal,
      });

      if (res.ok) {
        const body: any = await res.json();
        // OpenAI 格式是 { data: [{ id }] }；部分网关直接返回数组
        const raw: any[] = Array.isArray(body) ? body : body?.data || [];

        const ids = [
          ...new Set(
            raw
              .map((m: any) => (typeof m === 'string' ? m : m?.id))
              .filter((id): id is string => typeof id === 'string' && id.length > 0)
          ),
        ].sort();

        if (ids.length > 0) {
          // 接口只返回 id；元数据（读图能力/思考等级）用文档目录补全，
          // 文档没收录的新模型给通用兜底
          return {
            models: ids.map((id) => toOption(META_BY_ID.get(id) || metaForUnknown(id))),
            source: 'api',
            current: config.model,
          };
        }
      }
    } catch (err: any) {
      return {
        models: BUILTIN_MODELS,
        source: 'builtin',
        error: err?.name === 'AbortError' ? '查询模型列表超时' : err?.message || '无法连接模型服务',
        current: config.model,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { models: BUILTIN_MODELS, source: 'builtin', current: config.model };
}

/** 可用模型列表（设置页下拉框的数据源） */
router.get('/models', async (_req, res) => {
  try {
    const result = await fetchAvailableModels();
    res.json(result);
  } catch (error: any) {
    // 任何意外都不该让设置页打不开
    res.json({
      models: BUILTIN_MODELS,
      source: 'builtin',
      error: error?.message || '获取模型列表失败',
    });
  }
});

/**
 * 思考等级白名单 —— 各模型支持的档位不一致（文档确认的全集）：
 * 多数模型 low/medium/high/max，GLM 另有 minimal/xhigh，均可设 none 关闭思考。
 */
const EFFORT_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

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
