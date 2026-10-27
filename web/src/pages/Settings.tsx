import React, { useEffect, useState } from 'react';
import { Sliders, KeyRound, Save, ShieldCheck, Sparkles, AlertCircle, PenLine, BookOpen, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { Input, Select, Textarea } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';
import { usePreferences } from '../hooks/usePreferences';
import { useAuth } from '../context/AuthContext';

/** 档位文案（依据官方文档；各模型支持的档位不同，下拉里按所选模型过滤） */
const EFFORT_LABELS: Record<string, string> = {
  none: 'none（关闭思考 · 最快）',
  minimal: 'minimal（极轻量思考）',
  low: 'low（轻度推理 · 速度快，推荐）',
  medium: 'medium（平衡速度与效果）',
  high: 'high（更细致，稍慢）',
  xhigh: 'xhigh（高强度思考）',
  max: 'max（最强思考 · 最慢）',
};

interface SettingsState {
  provider: string;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  timeoutMs: string;
  promptStyle: string;
}

/** AI 服务商清单：id 与服务端设置键的命名空间一一对应 */
const AI_PROVIDERS = [
  { value: 'sensenova', label: 'SenseNova 官方' },
  { value: 'gemini-proxy', label: 'Gemini 转发代理（自建）' },
];

/** 当前 provider 下的设置键名：sensenova 沿用历史键，gemini-proxy 用独立命名空间 */
function keysOf(provider: string) {
  return provider === 'gemini-proxy'
    ? { model: 'ai.geminiProxy.model', baseUrl: 'ai.geminiProxy.baseUrl', apiKey: 'ai.geminiProxy.apiKey' }
    : { model: 'ai.model', baseUrl: 'ai.baseUrl', apiKey: 'ai.apiKey' };
}

export default function Settings() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [effortLevels, setEffortLevels] = useState<string[]>(['minimal', 'low', 'medium', 'high']);
  const [overridden, setOverridden] = useState<string[]>([]);
  // .env / 内置出厂值。用来区分「用户自己改过的」和「只是出厂值被回显上来」——
  // 不做这个区分，一次"没改任何东西只点保存"就会把所有出厂值写成覆盖，
  // 从此改 .env、切服务商都追不上界面上的旧值。
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  // 后端回的有效值原样快照（含可能是对象类型的密钥字段）。保存时要靠它判断
  // 「这个键后端到底给没给值」——没给值又不是自定义项，就说明前端对它没意见。
  const [effective, setEffective] = useState<Record<string, any>>({});

  const [apiKeyMasked, setApiKeyMasked] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKey, setApiKey] = useState('');

  const [form, setForm] = useState<SettingsState>({
    provider: 'sensenova',
    model: '',
    reasoningEffort: 'low',
    baseUrl: '',
    timeoutMs: '60000',
    promptStyle: '',
  });

  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const [changingPwd, setChangingPwd] = useState(false);

  // 听评课 Word 导出：评课人签名（也用于导出文件名）
  const { preferences, update: updatePreferences, loaded: prefsLoaded } = usePreferences();
  const { user } = useAuth();
  const [sigInput, setSigInput] = useState('');
  const [savingSig, setSavingSig] = useState(false);
  useEffect(() => {
    if (prefsLoaded) setSigInput(preferences.signature);
  }, [prefsLoaded, preferences.signature]);

  async function saveSignature() {
    setSavingSig(true);
    try {
      await updatePreferences({ signature: sigInput.trim() });
      toast.success('签名已保存');
    } catch {
      toast.error('保存失败，请重试');
    } finally {
      setSavingSig(false);
    }
  }

  // 课程目录：一键清除自己导入的课程规划，只保留系统内置那份
  //
  // 「清理重复课程」只能合并同一门课被灌两次的情况，合不掉「导入的是一套
  // 不一样的课表」——那种情况下目录只会越堆越多，去重永远收不拢。这里是更彻底
  // 的那把刀，所以放在设置页、且是危险操作，确认框里写清楚后果。
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function confirmResetCatalog() {
    setResetting(true);
    try {
      const r = await api.post('/catalog/reset-to-builtin', {});
      setResetOpen(false);
      toast.success(
        `已清除 ${r.removed} 条已导入课程、${r.importsRemoved} 条导入记录，目录现在剩 ${r.remaining} 条`
      );
      if (r.reseeded > 0) {
        toast.info(`重新灌库补回了 ${r.reseeded} 条系统内置课程`);
      }
      if (r.reassigned > 0) {
        toast.info(`${r.reassigned} 处月度总结/课堂观察的课时来源已改指到内置同名课`);
      }
      if (r.deduped > 0) {
        toast.info(`收尾又合并掉 ${r.deduped} 条重复课程`);
      }
    } catch (e: any) {
      toast.error(e.message || '清理失败，请重试');
    } finally {
      setResetting(false);
    }
  }

  // 模型下拉：后端用 API Key 实时查 /v1/models，查不到时回落内置列表
  const [modelOptions, setModelOptions] = useState<
    { id: string; label: string; name?: string; description?: string; vision?: boolean; efforts?: string[] }[]
  >([]);
  const [modelSource, setModelSource] = useState<'api' | 'builtin'>('builtin');
  const [modelError, setModelError] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(false);
  // 模型列表整个没取到时（网络异常/后端不可用），要明确告知而不是静默变输入框
  const [modelsFailed, setModelsFailed] = useState(false);

  /**
   * 拉取可用模型列表（首次加载与"重新获取"共用）。
   * 取不到时置 modelsFailed，让页面明确告知原因，而不是静默退回输入框。
   */
  const loadModels = async (savedEffort: string) => {
    const m = await api.get('/settings/models').catch(() => null);

    if (!m?.models?.length) {
      setModelsFailed(true);
      return;
    }

    setModelsFailed(false);
    setModelOptions(m.models);
    setModelSource(m.source || 'builtin');
    setModelError(m.error || '');

    // 当前配置的模型不在可选列表里 → 切到"自定义"模式并保留原值
    if (m.current && !m.models.some((x: any) => x.id === m.current)) {
      setUseCustomModel(true);
    }

    // 保存的档位不被当前模型支持（如 GLM 的 xhigh 换到别的模型）→
    // 对齐到该模型支持的档位，避免下拉显示与实际提交值不一致
    const meta = m.models.find((x: any) => x.id === m.current);
    if (meta?.efforts && !meta.efforts.includes(savedEffort)) {
      const snapped = meta.efforts.includes('low')
        ? 'low'
        : meta.efforts.find((e: string) => e !== 'none') || 'none';
      setForm((prev) => ({ ...prev, reasoningEffort: snapped }));
    }
  };

  const load = async () => {
    try {
      const r = await api.get('/settings');
      const s = r.settings || {};

      const provider = s['ai.provider'] || 'sensenova';
      const keys = keysOf(provider);

      setForm({
        provider,
        // 没在库里存过这个服务商的模型 / 地址时，回落到它自己的出厂值——
        // 否则切换服务商后这两个框会变空，用户以为配置丢了
        // （这正是「选了 sensenova 接口地址却不自动变」的直接原因）
        model: s[keys.model] || defaults[keys.model] || '',
        reasoningEffort: s['ai.reasoningEffort'] || 'low',
        baseUrl: s[keys.baseUrl] || defaults[keys.baseUrl] || '',
        timeoutMs: s['ai.timeoutMs'] || '60000',
        promptStyle: s['ai.prompt.style'] || '',
      });
      setApiKeyMasked(s[keys.apiKey]?.masked || '');
      setApiKeyConfigured(!!s[keys.apiKey]?.configured);
      setOverridden(r.overridden || []);
      setDefaults(r.meta?.defaults || {});
      setEffective(s);
      if (r.meta?.effortLevels?.length) setEffortLevels(r.meta.effortLevels);

      await loadModels(s['ai.reasoningEffort'] || 'low');
    } catch (err: any) {
      toast.error('读取设置失败：' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  /** 当前选中模型的元数据：思考等级档位、读图能力都从这里取 */
  const selectedModel = modelOptions.find((m) => m.id === form.model);

  const saveAi = async () => {
    setSaving(true);
    try {
      const keys = keysOf(form.provider);
      // 只提交「真的改过」的项。值等于 .env 出厂值的不写——写进去就等于把出厂值
      // 冻结成覆盖，以后改 .env、切服务商都追不上界面上的旧值。
      // 两种情况要处理：
      //   · 值 ≠ 出厂值 → 写入（这是用户真正的自定义）
      //   · 值 == 出厂值但之前改过 → 写空串清掉覆盖，才能真回到 .env
      //   · 值 == 出厂值且没改过 → 跳过（本来就没覆盖，写也白写）
      const patch: Record<string, string> = {};
      const dirty = (key: string, value: string) =>
        String(value ?? '') !== String(defaults[key] ?? '');
      const fields: Record<string, string> = {
        'ai.provider': form.provider,
        [keys.model]: form.model,
        'ai.reasoningEffort': form.reasoningEffort,
        [keys.baseUrl]: form.baseUrl,
        'ai.timeoutMs': form.timeoutMs,
        'ai.prompt.style': form.promptStyle,
      };
      for (const [key, value] of Object.entries(fields)) {
        // 后端没回这个键、也不是自定义项 → 前端对它没有意见，不要提交空串
        // （否则等于把「我不知道」伪装成「请清空」）
        if (!String(effective[key] ?? '') && !overridden.includes(key)) continue;
        if (dirty(key, value)) patch[key] = value;
        else if (overridden.includes(key)) patch[key] = '';
      }
      // 只有真的输入了新 key 才提交（否则会把掩码写回去）
      if (apiKey.trim()) patch[keys.apiKey] = apiKey.trim();

      if (Object.keys(patch).length === 0) {
        toast.info('没有需要保存的改动');
        return;
      }

      await api.put('/settings', patch);
      setApiKey('');
      toast.success('AI 设置已保存，下次生成立即生效');
      await load();
    } catch (err: any) {
      toast.error('保存失败：' + err.message);
    } finally {
      setSaving(false);
    }
  };

  /** 切换 AI 服务商：立即落库并整页重载设置——
   *  模型列表、Key 掩码、接口地址都是按当前服务商拉取/展示的。
   *  ① 乐观更新：表单先切到位，不等网络往返——否则「接口地址」
   *    会先显示旧服务商的地址，用户若在此窗口手动改地址 / 保存，
   *    会把值写进错误的命名空间。
   *  ② 切换期间禁用保存：load() 完成前保存同样会写错键。
   *  ③ 两个服务商的 Key 是完全独立的两个键（SENSENOVA_API_KEY /
   *    GEMINI_PROXY_API_KEY），掩码显示和未保存的输入必须一起换——
   *    只换 label 不换内容，用户会看到「新服务商的框里挂着旧服务商的
   *    掩码」；更糟的是已输入但未保存的 Key 会被下一次保存写进
   *    新服务商的键里，等于把 sensenova 的 key 存成 gemini 的 key。 */
  const [switching, setSwitching] = useState(false);
  const switchProvider = async (next: string) => {
    if (next === form.provider || switching) return;
    setSwitching(true);
    // 预览值取后端回传的出厂值，不要写死——用户 .env 里自定义了网关地址时，
    // 写死的默认值会先把界面带偏一次，再被 load() 拉回来，看起来像「跳了一下」
    const nextKeys = keysOf(next);
    // 模型先清空：下面 load() 会立刻拉回该服务商自己的模型，不用手填
    // 思考等级 / 超时 / 风格偏好是跨服务商共用的键，原样带着走
    setForm({
      provider: next,
      model: '',
      reasoningEffort: form.reasoningEffort,
      baseUrl: defaults[nextKeys.baseUrl] || '',
      timeoutMs: form.timeoutMs,
      promptStyle: form.promptStyle,
    });
    // Key 先清空：load() 会填回新服务商自己的掩码。不清的话，旧服务商的
    // 掩码会挂在新服务商的 label 下一闪，未保存的输入更会被写进新键。
    setApiKey('');
    setApiKeyMasked('');
    setApiKeyConfigured(false);
    try {
      // 同 saveAi：服务商等于出厂默认时不要写成覆盖（否则「已自定义」里会多出
      // 一个从没改过的 ai.provider，用户会以为点错地方了）；之前改过、现在切回
      // 默认则写空串清掉覆盖。
      const patch: Record<string, string> =
        next !== String(defaults['ai.provider'] ?? 'sensenova')
          ? { 'ai.provider': next }
          : overridden.includes('ai.provider')
            ? { 'ai.provider': '' }
            : {};
      if (Object.keys(patch).length > 0) {
        await api.put('/settings', patch);
      }
      toast.success('已切换 AI 服务商');
      await load();
    } catch (err: any) {
      toast.error('切换失败：' + err.message);
      await load();
    } finally {
      setSwitching(false);
    }
  };

  const clearOverride = async (key: string) => {
    try {
      await api.put('/settings', { [key]: '' });
      toast.success('已恢复为 .env 中的配置');
      await load();
    } catch (err: any) {
      toast.error('恢复失败：' + err.message);
    }
  };

  /** 一键清掉全部覆盖：所有项重新跟着 .env 走 */
  const clearAllOverrides = async () => {
    if (overridden.length === 0) return;
    const patch: Record<string, string> = {};
    for (const k of overridden) patch[k] = '';
    try {
      await api.put('/settings', patch);
      toast.success('已全部恢复为 .env 中的配置');
      await load();
    } catch (err: any) {
      toast.error('恢复失败：' + err.message);
    }
  };

  const changePassword = async () => {
    if (!pwd.current || !pwd.next) {
      toast.error('请填写当前密码与新密码');
      return;
    }
    if (pwd.next.length < 6) {
      toast.error('新密码长度至少 6 位');
      return;
    }
    if (pwd.next !== pwd.confirm) {
      toast.error('两次输入的新密码不一致');
      return;
    }

    setChangingPwd(true);
    try {
      await api.put('/auth/password', { currentPassword: pwd.current, newPassword: pwd.next });
      setPwd({ current: '', next: '', confirm: '' });
      toast.success('密码已修改，下次登录请使用新密码');
    } catch (err: any) {
      toast.error('修改密码失败：' + err.message);
    } finally {
      setChangingPwd(false);
    }
  };

  const isOverridden = (key: string) => overridden.includes(key);

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-up">
        <h1 className="text-2xl font-bold tracking-tight text-slate-800">设置</h1>
        <Card className="p-5">
          <p className="text-sm text-slate-400">加载中…</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800">设置</h1>
        <p className="mt-1 text-sm text-slate-400">
          这里的修改保存在数据库中，立即生效，无需重启容器；留空则沿用 .env 的配置。设置跟随账号：每个账号独立保存，互不影响
        </p>
      </div>

      {/* ===== AI 设置 ===== */}
      <Card className="lg:max-w-3xl">
        <CardHeader
          title="AI 生成设置"
          description="模型与思考等级会影响生成质量与速度"
          icon={<Sparkles className="h-4 w-4" />}
        />
        <div className="space-y-5 p-5">
          {/* AI 服务商：切换后模型列表 / 接口地址 / Key 各自独立，互不覆盖 */}
          <div>
            <Select
              label="AI 服务商"
              value={form.provider}
              onChange={(e) => void switchProvider(e.target.value)}
              options={AI_PROVIDERS}
              disabled={switching}
            />
            <p className="mt-1 text-xs text-slate-400">
              {form.provider === 'gemini-proxy'
                ? '你自建的 Gemini 转发代理（OpenAI 兼容）；Key 与模型独立保存，切回来配置不丢'
                : 'SenseNova 官方平台'}
            </p>
          </div>

          <div>
            {/* 模型改为下拉选择：常用模型一键切换，平台上新模型仍可手填 */}
            {!useCustomModel && modelOptions.length > 0 ? (
              <Select
                label="模型"
                value={form.model}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setUseCustomModel(true);
                    return;
                  }
                  const next = e.target.value;
                  // 各模型支持的档位不同：切换后若当前档位不被支持，回落到 low
                  const meta = modelOptions.find((m) => m.id === next);
                  const effortStillOk =
                    !meta?.efforts || meta.efforts.includes(form.reasoningEffort);
                  setForm({
                    ...form,
                    model: next,
                    reasoningEffort: effortStillOk ? form.reasoningEffort : 'low',
                  });
                }}
                options={[
                  ...modelOptions.map((m) => ({ value: m.id, label: m.label })),
                  { value: '__custom__', label: '自定义模型…' },
                ]}
              />
            ) : (
              <Input
                label="模型名称"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="如：sensenova-6.8-flash-lite"
              />
            )}

            {useCustomModel && modelOptions.length > 0 && (
              <button
                type="button"
                onClick={() => setUseCustomModel(false)}
                className="mt-1.5 text-xs text-brand-600 underline-offset-2 hover:underline"
              >
                ← 返回下拉选择
              </button>
            )}

            <p className="mt-1 text-xs text-slate-400">
              {modelsFailed
                ? '⚠ 没能获取到模型列表，已切换为手动输入'
                : modelSource === 'api'
                ? '列表来自平台实时查询（当前 Key 可用的全部模型）'
                : modelError
                ? '无法连接模型服务（' + modelError + '），先显示已知模型，填好 API Key 后刷新即可获取完整列表'
                : '填好 API Key 后会自动获取可用模型列表；这里也可手动填写'}
            </p>

            {modelsFailed && (
              <button
                type="button"
                onClick={() => loadModels(form.reasoningEffort)}
                className="mt-1.5 text-xs text-brand-600 underline-offset-2 hover:underline"
              >
                重新获取模型列表
              </button>
            )}
          </div>

          <div>
            <Select
              label="思考等级"
              value={form.reasoningEffort}
              onChange={(e) => setForm({ ...form, reasoningEffort: e.target.value })}
              options={(selectedModel?.efforts || effortLevels).map((v) => ({
                value: v,
                label: EFFORT_LABELS[v] || v,
              }))}
            />
            <p className="mt-1 text-xs text-slate-400">
              {selectedModel
                ? '档位来自「' + selectedModel.name + '」官方文档；none 为关闭思考（最快）'
                : '等级越高，模型"想"得越久，文案更细致但更慢'}
            </p>
          </div>

          {/* 该模型不支持读图时的提示：本项目会把作业照片发给模型 */}
          {selectedModel && selectedModel.vision === false && (
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 p-3.5 ring-1 ring-amber-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p className="text-xs leading-relaxed text-amber-700">
                「{selectedModel.name}」不支持读取图片 ——
                上传课堂作业照片时，AI 将无法参考照片内容，只能依据文字描述生成。
                建议选择带"多模态"字样的模型。
              </p>
            </div>
          )}

          <div>
            <Input
              label="接口地址"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder={form.provider === 'gemini-proxy' ? 'https://api.gemmaproxy.dpdns.org/v1' : 'https://token.sensenova.cn/v1'}
            />
            <p className="mt-1 text-xs text-slate-400">
              {overridden.includes(form.provider === 'gemini-proxy' ? 'ai.geminiProxy.baseUrl' : 'ai.baseUrl')
                ? '已自定义，优先级高于 .env —— 改 .env 不会再变这里'
                : '沿用 .env 中的配置，改 .env 会自动生效'}
            </p>
          </div>

          <div>
            <Input
              label="超时时间（毫秒）"
              value={form.timeoutMs}
              onChange={(e) => setForm({ ...form, timeoutMs: e.target.value })}
              placeholder="60000"
            />
            <p className="mt-1 text-xs text-slate-400">5 秒 ~ 5 分钟。网络慢可适当调大</p>
          </div>

          <div>
            <Input
              label={form.provider === 'gemini-proxy' ? 'Gemini 代理 API Key' : 'SenseNova API Key'}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={apiKeyConfigured ? '已配置（留空则不修改）' : '请填写服务商的 API Key'}
              icon={<KeyRound className="h-4 w-4" />}
            />
            <div className="mt-1.5 flex items-center gap-2 text-xs">
              {apiKeyConfigured ? (
                <Badge tone="success">
                  <ShieldCheck className="h-3 w-3" />
                  已配置 {apiKeyMasked}
                </Badge>
              ) : (
                <Badge tone="warning">未配置，无法生成回访</Badge>
              )}
              <span className="text-slate-400">出于安全考虑，密钥不会回显完整内容</span>
            </div>
          </div>

          <div>
            <Textarea
              label="风格偏好（可选）"
              value={form.promptStyle}
              onChange={(e) => setForm({ ...form, promptStyle: e.target.value })}
              placeholder="例如：少用 emoji，语气更正式；重点鼓励、少提缺点"
              hint="填了会作为「风格偏好」追加进 AI 提示词；留空则用默认语气。最多 500 字。"
              rows={3}
            />
          </div>

          {overridden.length > 0 && (
            <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-100">
              <p className="mb-2 text-xs font-medium text-slate-500">
                以下项已被自定义（未列出的项沿用 .env）
              </p>
              <div className="flex flex-wrap gap-1.5">
                {overridden.map((k) => (
                  <button
                    key={k}
                    onClick={() => clearOverride(k)}
                    title="点击恢复为 .env 中的配置"
                    className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100"
                  >
                    {k.replace(/^ai\.geminiProxy\./, 'geminiProxy.').replace(/^ai\./, '')} ✕
                  </button>
                ))}
                <button
                  onClick={clearAllOverrides}
                  className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-600 ring-1 ring-brand-200 transition-colors hover:bg-brand-100"
                >
                  全部恢复为 .env
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                自定义项的优先级高于 .env —— 自定义了就改不动 .env。想跟着 .env 走就点上面的 ✕ 清掉
              </p>
            </div>
          )}

          <Button onClick={saveAi} loading={saving} disabled={switching} icon={<Save className="h-4 w-4" />}>
            保存 AI 设置
          </Button>
        </div>
      </Card>

      {/* ===== 课程目录维护 ===== */}
      <Card className="lg:max-w-3xl ring-1 ring-red-100">
        <CardHeader
          title="课程目录维护"
          description="清除自己导入的课程规划，目录只保留系统内置那份"
          icon={<BookOpen className="h-4 w-4" />}
        />
        <div className="space-y-4 p-5">
          <p className="text-sm leading-relaxed text-slate-500">
            目录是机构级共享数据。如果你导入过自己的一套课程规划、条目数一直居高不下，
            可以一键清掉自己导入的部分，只留随镜像发版的系统内置课程。
          </p>
          <div className="rounded-xl bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-500">
            <span className="font-medium text-slate-600">会清除：</span>
            所有你自己导入的课程条目与导入记录（系统内置那份不受影响）<br />
            <span className="font-medium text-slate-600">会保留：</span>
            月度总结与课堂观察本身不动，它们指向被删课程的课时来源会自动改指到内置同名课
          </div>
          <Button
            variant="danger"
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => setResetOpen(true)}
            data-testid="reset-catalog-to-builtin"
          >
            清除已导入课程规划，只保留系统内置
          </Button>
        </div>
      </Card>

      {/* ===== 听评课 Word 导出 ===== */}
      <Card className="lg:max-w-3xl">
        <CardHeader
          title="听评课 Word 导出"
          description="导出《星火个性化教学听评课表》时会填到表上的信息"
          icon={<PenLine className="h-4 w-4" />}
        />
        <div className="space-y-4 p-5">
          <Input
            label="评课人签名"
            value={sigInput}
            onChange={(e) => setSigInput(e.target.value)}
            placeholder={user?.username || '留空则用登录用户名'}
            maxLength={20}
            hint="填在表末「评课人签名：」后面。导出文件名用的是**被听课老师**的姓名，例如 星火个性化教学听评课表 10.17 周江凌.docx"
          />
          <Button
            onClick={saveSignature}
            loading={savingSig}
            disabled={sigInput.trim() === preferences.signature}
            icon={<Save className="h-4 w-4" />}
          >
            保存签名
          </Button>
        </div>
      </Card>

      {/* ===== 修改密码 ===== */}
      <Card className="lg:max-w-3xl">
        <CardHeader
          title="修改密码"
          description="修改后其它设备需要重新登录"
          icon={<Sliders className="h-4 w-4" />}
        />
        <div className="space-y-4 p-5">
          <Input
            label="当前密码"
            type="password"
            value={pwd.current}
            onChange={(e) => setPwd({ ...pwd, current: e.target.value })}
            autoComplete="current-password"
          />
          <Input
            label="新密码"
            type="password"
            value={pwd.next}
            onChange={(e) => setPwd({ ...pwd, next: e.target.value })}
            placeholder="至少 6 位"
            autoComplete="new-password"
          />
          <Input
            label="确认新密码"
            type="password"
            value={pwd.confirm}
            onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
            autoComplete="new-password"
          />

          <Button onClick={changePassword} loading={changingPwd} icon={<KeyRound className="h-4 w-4" />}>
            修改密码
          </Button>

          <p className="text-xs text-slate-400">
            需要先验证当前密码 —— 避免登录凭证泄露后被直接改密夺号
          </p>
        </div>
      </Card>

      <ConfirmDialog
        open={resetOpen}
        danger
        loading={resetting}
        title="清除已导入的课程规划？"
        description="目录里所有你自己导入的课程条目和导入记录都会被删掉，只保留系统内置那份。月度总结与课堂观察本身不动，但课时来源会被改指到内置同名课。这个操作不可撤销，建议先做一次数据库备份。"
        confirmText="清除，只保留系统内置"
        onConfirm={confirmResetCatalog}
        onCancel={() => setResetOpen(false)}
      />
    </div>
  );
}
