import { useState, type FormEvent } from 'react';
import { CheckCircle2, KeyRound, Link2, LogOut, MessageSquareText } from 'lucide-react';
import { api } from '../../api/client';
import type { TwoStepMethod } from '../../lib/teachingData';
import { useToast } from '../ui/Toast';
import Button from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Input, Select } from '../ui/Field';

interface LoginResponse {
  token?: string;
  needTwoStep?: boolean;
  twoStepId?: string;
  methods?: TwoStepMethod[];
  message?: string;
}

interface ConnectionPanelProps {
  connected: boolean;
  onToken: (token: string) => void;
  onDisconnect: () => void;
}

export default function ConnectionPanel({ connected, onToken, onDisconnect }: ConnectionPanelProps) {
  const { success, error } = useToast();
  const [mode, setMode] = useState<'account' | 'manual'>('account');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [twoStepId, setTwoStepId] = useState('');
  const [methods, setMethods] = useState<TwoStepMethod[]>([]);
  const [method, setMethod] = useState<TwoStepMethod>('sms');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState<'login' | 'send' | 'verify' | null>(null);

  function fail(reason: unknown) {
    const text = reason instanceof Error ? reason.message : '连接教学平台失败';
    setLocalError(text);
    error(text);
  }

  function acceptToken(token: string) {
    onToken(token);
    setPassword('');
    setManualToken('');
    setCode('');
    setTwoStepId('');
    setMessage('');
    setLocalError('');
    success('教学平台连接成功');
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setLocalError('');
    if (mode === 'manual') {
      if (!manualToken.trim()) {
        setLocalError('请输入教学平台 Token');
        return;
      }
      acceptToken(manualToken.trim());
      return;
    }
    if (!account.trim() || !password) {
      setLocalError('请输入教学平台账号和密码');
      return;
    }
    setBusy('login');
    try {
      const response = await api.post<LoginResponse>('/teaching-data/login', {
        account: account.trim(),
        password,
      });
      if (response.needTwoStep) {
        setTwoStepId(response.twoStepId || '');
        const available: TwoStepMethod[] = response.methods?.length ? response.methods : ['sms'];
        setMethods(available);
        setMethod(available[0]);
        setMessage(response.message || '账号验证通过，请完成二次验证');
      } else if (response.token) {
        acceptToken(response.token);
      } else {
        setLocalError('教学平台未返回有效连接凭证');
      }
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(null);
    }
  }

  async function sendCode() {
    if (!twoStepId) return;
    setBusy('send');
    setLocalError('');
    try {
      const response = await api.post<{ message?: string }>('/teaching-data/two-step/send', {
        twoStepId,
        method,
      });
      setMessage(response.message || '验证码已发送');
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(null);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) {
      setLocalError('请输入二次验证码');
      return;
    }
    setBusy('verify');
    setLocalError('');
    try {
      const response = await api.post<LoginResponse>('/teaching-data/two-step/verify', {
        twoStepId,
        code: code.trim(),
      });
      if (response.token) acceptToken(response.token);
      else setLocalError('二次验证未返回有效连接凭证');
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<Link2 className="h-5 w-5" />}
        title="连接晓教育平台"
        description="账号密码、手动 Token 和二次验证任选适用方式；连接仅保留在当前页面内存中"
        action={connected ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> 已连接
          </span>
        ) : undefined}
      />
      <CardBody>
        {connected ? (
          <div className="flex flex-col gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-emerald-900">现在可以设置筛选条件并提取数据。刷新页面后需重新连接。</p>
            <Button type="button" variant="outline" size="sm" icon={<LogOut className="h-4 w-4" />} onClick={onDisconnect}>
              断开连接
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex w-fit rounded-xl bg-slate-100 p-1" aria-label="连接方式">
              {(['account', 'manual'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={mode === item}
                  onClick={() => { setMode(item); setLocalError(''); setTwoStepId(''); setMessage(''); }}
                  className={'rounded-lg px-4 py-2 text-sm font-medium transition ' + (mode === item ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
                >
                  {item === 'account' ? '账号登录' : '手动 Token'}
                </button>
              ))}
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              {mode === 'account' ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Input label="教学平台账号" value={account} onChange={(event) => setAccount(event.target.value)} autoComplete="username" placeholder="请输入晓教育账号" />
                  <Input label="教学平台密码" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="登录后不会保存密码" />
                </div>
              ) : (
                <Input label="教学平台 Token" type="password" value={manualToken} onChange={(event) => setManualToken(event.target.value)} autoComplete="off" placeholder="粘贴已有 Token，内容不会回显或保存" />
              )}
              <Button type="submit" loading={busy === 'login'} icon={<KeyRound className="h-4 w-4" />}>
                {mode === 'account' ? '登录并连接' : '使用此 Token 连接'}
              </Button>
            </form>

            {twoStepId && mode === 'account' && (
              <form onSubmit={verifyCode} className="space-y-4 rounded-xl border border-brand-100 bg-brand-50/50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-brand-900">
                  <MessageSquareText className="h-4 w-4" /> 二次验证
                </div>
                {message && <p className="text-sm text-brand-800">{message}</p>}
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
                  <Input label="验证码" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="请输入收到的验证码" />
                  <Select label="接收方式" value={method} onChange={(event) => setMethod(event.target.value as TwoStepMethod)} options={methods.map((item) => ({ value: item, label: item === 'sms' ? '短信' : '企业微信' }))} />
                  <Button type="button" variant="outline" loading={busy === 'send'} onClick={sendCode}>发送验证码</Button>
                </div>
                <Button type="submit" loading={busy === 'verify'}>完成二次验证</Button>
              </form>
            )}

            {localError && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{localError}</p>}
            <p className="text-xs leading-5 text-slate-500">密码、Token、验证码不会写入浏览器存储；提取结果按当前工作台账号隔离。</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
