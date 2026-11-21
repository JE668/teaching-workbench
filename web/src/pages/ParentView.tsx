import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertCircle,
  BookOpen,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  HeartHandshake,
  Lightbulb,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import { api } from '../api/client';

interface ParentViewData {
  key_progress: string[];
  focus_areas: string[];
  action_for_parent: string;
  teacher_note: string;
}

interface ParentViewPayload {
  studentName: string;
  subject: string;
  sourceType: 'followup' | 'report';
  sourceId: number;
  createdAt: string;
  viewData: ParentViewData;
  readAt: string | null;
  parentFeedback: string | null;
}

function cleanItems(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : [];
}

function displayDate(value: string): string {
  if (!value) return '';
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + '+08:00');
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

export default function ParentView() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<ParentViewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ message: string; unavailable: boolean } | null>(null);
  const [feedback, setFeedback] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const readRequested = useRef('');

  const load = useCallback(async () => {
    setView(null);
    setLoadError(null);
    setFeedback('');
    setFeedbackError('');
    readRequested.current = '';
    if (!token) {
      setLoading(false);
      setLoadError({ message: '链接不完整，请向老师重新获取家长查阅链接。', unavailable: true });
      return;
    }
    setLoading(true);
    try {
      const response = await api.request<{ success: boolean; data: ParentViewPayload }>('/parent-view/' + encodeURIComponent(token));
      if (!response?.data || typeof response.data !== 'object') {
        throw new Error('家长视图响应格式不完整');
      }
      setView(response.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载失败，请稍后重试';
      const unavailable = /not found|expired|404|不存在|过期/i.test(message);
      setLoadError({
        message: unavailable ? '链接不存在或已过期，请联系老师重新生成。' : message,
        unavailable,
      });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // 打开公开链接即记录查阅；该操作不阻塞内容展示，失败也不影响家长阅读。
  useEffect(() => {
    if (!token || !view || view.readAt || readRequested.current === token) return;
    readRequested.current = token;
    let active = true;
    void api.post('/parent-view/' + encodeURIComponent(token) + '/read', {})
      .then(() => {
        if (active) {
          setView((current) => current ? { ...current, readAt: new Date().toISOString() } : current);
        }
      })
      .catch(() => {
        // 阅读记录是辅助功能，网络异常时保留页面内容。
      });
    return () => { active = false; };
  }, [token, view]);

  const progress = useMemo(() => cleanItems(view?.viewData?.key_progress), [view]);
  const focusAreas = useMemo(() => cleanItems(view?.viewData?.focus_areas), [view]);
  const actionForParent = view?.viewData?.action_for_parent?.trim() || '';
  const teacherNote = view?.viewData?.teacher_note?.trim() || '';
  const hasContent = progress.length > 0 || focusAreas.length > 0 || !!actionForParent || !!teacherNote;
  const feedbackLength = Array.from(feedback).length;
  const feedbackInvalid = !feedback.trim() || feedbackLength > 1000;

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || feedbackInvalid || feedbackSending) return;
    setFeedbackSending(true);
    setFeedbackError('');
    try {
      await api.post('/parent-view/' + encodeURIComponent(token) + '/feedback', { feedback: feedback.trim() });
      setView((current) => current ? { ...current, parentFeedback: feedback.trim() } : current);
      setFeedback('');
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : '提交失败，请稍后重试');
    } finally {
      setFeedbackSending(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6" aria-busy="true" aria-live="polite">
        <div className="text-center">
          <Loader2 className="mx-auto h-9 w-9 animate-spin text-brand-600" />
          <p className="mt-4 text-sm font-medium text-slate-600">正在打开学习反馈…</p>
        </div>
      </main>
    );
  }

  if (loadError || !view) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12">
        <section className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-soft ring-1 ring-slate-100">
          <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${loadError?.unavailable ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-500'}`}>
            {loadError?.unavailable ? <Clock3 className="h-7 w-7" /> : <AlertCircle className="h-7 w-7" />}
          </div>
          <h1 className="mt-5 text-xl font-semibold text-slate-800">
            {loadError?.unavailable ? '暂时无法查看' : '加载没有成功'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {loadError?.message || '暂时没有可展示的内容，请联系老师。'}
          </p>
          {!loadError?.unavailable && (
            <button
              type="button"
              onClick={() => void load()}
              className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-medium text-white transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              <RefreshCw className="h-4 w-4" /> 重新加载
            </button>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f8fc] pb-12 text-slate-800">
      <div className="bg-gradient-to-br from-brand-700 via-brand-600 to-violet-600 pb-20 pt-8 text-white sm:pt-12">
        <div className="mx-auto max-w-3xl px-5">
          <div className="flex items-center gap-2 text-sm text-white/80">
            <HeartHandshake className="h-5 w-5" />
            <span>家校共育 · 学习反馈</span>
          </div>
          <h1 className="mt-7 text-2xl font-semibold tracking-tight sm:text-3xl">
            {view.studentName || '同学'}的学习反馈
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/80">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 ring-1 ring-inset ring-white/20">
              <BookOpen className="h-4 w-4" /> {view.subject || '学科未填写'}
            </span>
            <span>{view.sourceType === 'report' ? '月度学习报告' : '课后回访'}</span>
            {view.createdAt && <span>{displayDate(view.createdAt)}</span>}
          </div>
        </div>
      </div>

      <div className="mx-auto -mt-10 max-w-3xl space-y-5 px-4 sm:px-5">
        {!hasContent && (
          <section className="rounded-3xl bg-white px-6 py-12 text-center shadow-soft ring-1 ring-slate-100">
            <FileText className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-4 text-lg font-semibold text-slate-700">老师暂未填写学习反馈</h2>
            <p className="mt-2 text-sm text-slate-400">内容整理后会展示在这里，您也可以先在下方给老师留言。</p>
          </section>
        )}

        {(progress.length > 0 || hasContent) && (
          <section className="rounded-3xl bg-white p-5 shadow-soft ring-1 ring-slate-100 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <TrendingUp className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-semibold">关键进展</h2>
                <p className="mt-0.5 text-xs text-slate-400">这一阶段值得肯定的成长</p>
              </div>
            </div>
            {progress.length > 0 ? (
              <ul className="mt-5 space-y-3">
                {progress.map((item, index) => (
                  <li key={`progress-${index}`} className="flex items-start gap-3 rounded-2xl bg-emerald-50/60 px-4 py-3.5">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                    <span className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-400">暂无关键进展记录</p>
            )}
          </section>
        )}

        {(focusAreas.length > 0 || hasContent) && (
          <section className="rounded-3xl bg-white p-5 shadow-soft ring-1 ring-slate-100 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                <Target className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-semibold">重点关注</h2>
                <p className="mt-0.5 text-xs text-slate-400">接下来一起留意的方向</p>
              </div>
            </div>
            {focusAreas.length > 0 ? (
              <ul className="mt-5 space-y-3">
                {focusAreas.map((item, index) => (
                  <li key={`focus-${index}`} className="flex items-start gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                    <span className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-400">暂无重点关注事项</p>
            )}
          </section>
        )}

        {actionForParent && (
          <section className="overflow-hidden rounded-3xl bg-white shadow-soft ring-1 ring-slate-100">
            <div className="flex items-center gap-3 border-b border-brand-50 bg-brand-50/60 px-5 py-4 sm:px-7">
              <Lightbulb className="h-5 w-5 text-brand-600" />
              <h2 className="text-lg font-semibold">下周关注与家庭行动</h2>
            </div>
            <p className="whitespace-pre-wrap px-5 py-6 text-sm leading-7 text-slate-700 sm:px-7">{actionForParent}</p>
          </section>
        )}

        {teacherNote && (
          <section className="rounded-3xl bg-gradient-to-br from-violet-50 to-white p-5 shadow-soft ring-1 ring-violet-100 sm:p-7">
            <div className="flex items-center gap-2 text-violet-700">
              <Sparkles className="h-5 w-5" />
              <h2 className="font-semibold">老师寄语</h2>
            </div>
            <blockquote className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700">{teacherNote}</blockquote>
          </section>
        )}

        <section className="rounded-3xl bg-white p-5 shadow-soft ring-1 ring-slate-100 sm:p-7">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
              <MessageSquareText className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">给老师留言</h2>
              <p className="mt-0.5 text-xs text-slate-400">您的想法会帮助老师更好地陪伴孩子</p>
            </div>
          </div>

          {view.parentFeedback ? (
            <div className="mt-5 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-100" role="status">
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                <Check className="h-4 w-4" /> 反馈已提交，老师可以在工作台查看
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{view.parentFeedback}</p>
            </div>
          ) : (
            <form className="mt-5" onSubmit={(event) => void submitFeedback(event)}>
              <label htmlFor="parent-feedback" className="sr-only">反馈内容</label>
              <textarea
                id="parent-feedback"
                value={feedback}
                onChange={(event) => { setFeedback(event.target.value); setFeedbackError(''); }}
                maxLength={1000}
                rows={4}
                placeholder="例如：孩子最近在家练习时……"
                className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">{feedbackLength}/1000</span>
                <button
                  type="submit"
                  disabled={feedbackInvalid || feedbackSending}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-medium text-white transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {feedbackSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {feedbackSending ? '提交中…' : '提交反馈'}
                </button>
              </div>
              {feedbackError && (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-600" role="alert">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {feedbackError}
                </p>
              )}
            </form>
          )}
        </section>

        <p className="pt-2 text-center text-xs leading-5 text-slate-400">
          此页面由老师生成，仅用于本次学习沟通，请勿转发给无关人员。
        </p>
      </div>
    </main>
  );
}
