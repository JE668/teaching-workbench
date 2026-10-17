import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Sparkles,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  Plus,
  GraduationCap,
} from 'lucide-react';
import { api } from '../api/client';
import {
  Observation,
  Teacher,
  LESSON_TYPES,
  OVERALL_GRADES,
  OBSERVATION_STATUS,
  GRADES,
  SUBJECTS,
  overallGradeLabel,
} from '../types/index';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Input, Select, Textarea } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';
import { VoiceButton } from '../components/ui/VoiceButton';
import { copyText, saveBlob, relativeTime } from '../lib/utils';
import { splitReport, buildReportFilename } from '../lib/observation';
import { downloadObservationCard } from '../lib/observationCard';

const NEW = '__new__';

const emptyForm = {
  teacherSel: '',
  newTeacherName: '',
  topic: '',
  lessonType: 'new',
  observedAt: '',
  grade: '',
  subject: '',
  level: '',
  studentName: '',
  classNotes: '',
  overallGrade: '',
  status: 'draft',
  teacherReply: '',
};

export default function ObservationEdit() {
  const { id } = useParams();
  const recordId = id ? parseInt(id, 10) : null;
  const isNew = recordId === null;
  const navigate = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(!isNew);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [report, setReport] = useState('');
  const [reportAt, setReportAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // 载入老师列表
  useEffect(() => {
    api
      .get('/teachers')
      .then((r) => setTeachers(r.teachers || []))
      .catch(() => {
        /* 老师列表加载失败不影响主流程 */
      });
  }, []);

  // 编辑既有记录
  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const r = await api.get('/observations/' + recordId);
        const o = r.observation as Observation;
        setForm({
          teacherSel: o.teacherId ? String(o.teacherId) : '',
          newTeacherName: o.teacherName && o.teacherName !== '—' ? o.teacherName : '',
          topic: o.topic,
          lessonType: o.lessonType,
          observedAt: o.observedAt || '',
          grade: o.grade || '',
          subject: o.subject || '',
          level: o.level || '',
          studentName: o.studentName || '',
          classNotes: o.classNotes || '',
          overallGrade: o.overallGrade || '',
          status: o.status || 'draft',
          teacherReply: o.teacherReply || '',
        });
        setReport(o.report || '');
        setReportAt(o.reportAt || null);
      } catch (err: any) {
        toast.error('加载失败：' + err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [recordId]);

  /** 保存记录（新建则 POST，已有则 PUT），返回记录 id */
  const save = async (): Promise<number> => {
    // 解析老师：新建老师 / 已选 / 无
    let teacherId: number | null = null;
    if (form.teacherSel === NEW && form.newTeacherName.trim()) {
      const t = await api.post('/teachers', { name: form.newTeacherName.trim() });
      teacherId = t.teacher.id;
      setTeachers((prev) => [...prev, t.teacher]);
    } else if (form.teacherSel && form.teacherSel !== NEW) {
      teacherId = Number(form.teacherSel);
    }

    const payload = {
      teacherId,
      topic: form.topic.trim(),
      lessonType: form.lessonType,
      observedAt: form.observedAt || null,
      grade: form.grade || null,
      subject: form.subject || null,
      level: form.level || null,
      studentName: form.studentName || null,
      classNotes: form.classNotes,
      overallGrade: form.overallGrade || null,
      status: form.status,
      teacherReply: form.teacherReply,
    };

    if (isNew) {
      const r = await api.post('/observations', payload);
      return r.observation.id;
    }
    const r = await api.put('/observations/' + recordId, payload);
    setReport(r.observation.report || '');
    setReportAt(r.observation.reportAt || null);
    return recordId as number;
  };

  const handleSave = async () => {
    if (!form.topic.trim()) {
      toast.error('请填写课题');
      return;
    }
    setSaving(true);
    try {
      const tid = await save();
      toast.success(isNew ? '听课记录已保存' : '已保存');
      if (isNew) navigate('/observations/' + tid, { replace: true });
    } catch (err: any) {
      toast.error('保存失败：' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const tid = await save();
      setReport(''); // 清空旧报告，开始流式
      await api.streamPost('/observations/' + tid + '/report/stream', {}, {
        onDelta: (text) => setReport((prev) => prev + text),
        onDone: (payload: any) => {
          if (payload?.report) setReport(payload.report);
          setReportAt(new Date().toISOString());
          const grade = payload?.suggestedGrade || payload?.overallGrade;
          if (grade) setForm((f) => ({ ...f, overallGrade: f.overallGrade || grade }));
          toast.success('评课报告已生成');
        },
        onError: (msg: string) => toast.error('生成失败：' + msg),
      });
    } catch (err: any) {
      toast.error('生成失败：' + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { head, tail } = splitReport(report);
  const teacherOptions = [
    ...teachers.map((t) => ({
      value: String(t.id),
      label: t.subject ? t.name + ' · ' + t.subject : t.name,
    })),
    { value: NEW, label: '＋ 新建老师' },
  ];

  const downloadTxt = () => {
    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
    const display =
      form.newTeacherName || teachers.find((t: Teacher) => String(t.id) === form.teacherSel)?.name || '';
    saveBlob(blob, buildReportFilename(display, form.topic));
    toast.success('已导出 .txt');
  };

  const downloadDocx = async () => {
    if (!recordId) return;
    setDownloading(true);
    try {
      const blob = await api.download('/observations/' + recordId + '/docx');
      const display =
        form.newTeacherName || teachers.find((t: Teacher) => String(t.id) === form.teacherSel)?.name || '';
      saveBlob(blob, buildReportFilename(display, form.topic).replace(/\.txt$/, '.docx'));
      toast.success('已导出 Word');
    } catch (err: any) {
      toast.error('导出 Word 失败：' + err.message);
    } finally {
      setDownloading(false);
    }
  };

  const downloadCard = () => {
    const display =
      form.newTeacherName || teachers.find((t: Teacher) => String(t.id) === form.teacherSel)?.name || '';
    downloadObservationCard(
      {
        content: report,
        teacherName: display || undefined,
        topic: form.topic || undefined,
        dateLabel: form.observedAt || undefined,
        gradeLabel: overallGradeLabel(form.overallGrade) || undefined,
      },
      buildReportFilename(display, form.topic).replace(/\.txt$/, '.png')
    );
    toast.success('已导出图片卡片');
  };

  const doCopy = async (text: string, label: string) => {
    const ok = await copyText(text);
    ok ? toast.success('已复制' + label) : toast.error('复制失败，请手动选择文本');
  };

  return (
    <div className="space-y-6 animate-fade-up">
      {/* 头部 */}
      <div className="flex items-center gap-3">
        <Link to="/observations" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">
            {isNew ? '新建听课记录' : '听课记录详情'}
          </h1>
          <p className="mt-0.5 text-sm text-slate-400">
            记录课堂实录 → AI 生成评课 → 复制进「星火个性化教学听评课表」
          </p>
        </div>
      </div>

      {loading ? (
        <Card>
          <div className="p-8 text-center text-sm text-slate-400">加载中…</div>
        </Card>
      ) : (
        <>
          {/* ===== 基本信息（对应 Word 表 4 栏）===== */}
          <Card>
            <CardHeader
              title="基本信息"
              description="对应听评课表的表头四栏：老师 / 听课时间 / 课题 / 课型"
              icon={<GraduationCap className="h-4 w-4" />}
            />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div>
                <Select
                  label="被听课老师"
                  value={form.teacherSel}
                  onChange={(e) => set('teacherSel', e.target.value)}
                  options={teacherOptions}
                  placeholder="未关联"
                />
                {form.teacherSel === NEW ? (
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      value={form.newTeacherName}
                      onChange={(e) => set('newTeacherName', e.target.value)}
                      placeholder="输入新老师姓名"
                      autoFocus
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      icon={<Plus className="h-3.5 w-3.5" />}
                      onClick={async () => {
                        if (!form.newTeacherName.trim()) return toast.error('请填写老师姓名');
                        const t = await api.post('/teachers', { name: form.newTeacherName.trim() });
                        setTeachers((prev) => [...prev, t.teacher]);
                        set('teacherSel', String(t.teacher.id));
                        toast.success('已添加老师「' + t.teacher.name + '」');
                      }}
                    >
                      添加
                    </Button>
                  </div>
                ) : null}
              </div>
              <Input
                label="听课时间"
                type="date"
                value={form.observedAt}
                onChange={(e) => set('observedAt', e.target.value)}
              />
              <Input
                label="课题"
                required
                value={form.topic}
                onChange={(e) => set('topic', e.target.value)}
                placeholder="如：分数加减法运算"
              />
              <Select
                label="课型"
                value={form.lessonType}
                onChange={(e) => set('lessonType', e.target.value)}
                options={LESSON_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              />
            </div>
          </Card>

          {/* ===== AI 参考信息（不进 Word 表）===== */}
          <Card>
            <CardHeader
              title="AI 参考信息"
              description="帮助模型结合课程标准与学情给更准的评价；这些字段不出现在 Word 表里"
              icon={<Sparkles className="h-4 w-4" />}
            />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Select
                label="年级"
                value={form.grade}
                onChange={(e) => set('grade', e.target.value)}
                placeholder="选填"
                options={GRADES.map((g) => ({ value: g, label: g }))}
              />
              <Select
                label="科目"
                value={form.subject}
                onChange={(e) => set('subject', e.target.value)}
                placeholder="选填"
                options={SUBJECTS.map((s) => ({ value: s, label: s }))}
              />
              <Input
                label="学生水平"
                value={form.level}
                onChange={(e) => set('level', e.target.value)}
                placeholder="如：基础 / 中等 / 提高（选填）"
              />
              <Input
                label="学生姓名"
                value={form.studentName}
                onChange={(e) => set('studentName', e.target.value)}
                placeholder="1对1 学生（选填）"
              />
            </div>
          </Card>

          {/* ===== 听课记录（AI 评课依据，可语音）===== */}
          <Card>
            <CardHeader
              title="听课记录 / 课堂实录"
              description="你旁听时记下的老师上课过程，是 AI 评课的主要依据"
            />
            <div className="p-5">
              <Textarea
                rows={6}
                value={form.classNotes}
                onChange={(e) => set('classNotes', e.target.value)}
                placeholder="如：导入用生活实例引入分数加减法，讲解通分时结合图形演示，学生主动回应三次，练习环节节奏偏快…"
                hint={
                  <VoiceButton
                    onText={(t) => setForm((f) => ({ ...f, classNotes: f.classNotes + t }))}
                  />
                }
              />
            </div>
          </Card>

          {/* ===== 评课报告 ===== */}
          <Card>
            <CardHeader
              title="评课报告"
              description={
                report
                  ? '已生成 · 复制进 Word 表即可。可随时重新生成'
                  : '尚未生成 · 填写听课记录后点「AI 生成评课」'
              }
              icon={<FileText className="h-4 w-4" />}
              action={
                <div className="flex items-center gap-2">
                  <Button
                    variant={report ? 'outline' : 'gradient'}
                    size="sm"
                    loading={generating}
                    icon={report ? <Copy className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                    onClick={handleGenerate}
                  >
                    {report ? '重新生成' : 'AI 生成评课'}
                  </Button>
                  {report ? (
                    <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={downloadTxt}>
                      下载 .txt
                    </Button>
                  ) : null}
                  {report && recordId ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<FileText className="h-3.5 w-3.5" />}
                      loading={downloading}
                      onClick={downloadDocx}
                    >
                      下载 Word
                    </Button>
                  ) : null}
                  {report ? (
                    <Button
                      variant="outline"
                      size="sm"
                      icon={<ImageIcon className="h-3.5 w-3.5" />}
                      onClick={downloadCard}
                    >
                      图片卡片
                    </Button>
                  ) : null}
                </div>
              }
            />

            {report ? (
              <div className="space-y-4 p-5">
                {/* 报告正文（等宽保留换行，方便整段复制进 Word） */}
                <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 font-sans text-sm leading-relaxed text-slate-700 ring-1 ring-slate-100">
                  {report}
                </pre>

                {/* 分块复制 */}
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => doCopy(report, '整份评课')}>
                    复制整份
                  </Button>
                  {head ? (
                    <Button variant="secondary" size="sm" onClick={() => doCopy(head, '听课人评价')}>
                      复制听课人评价
                    </Button>
                  ) : null}
                  {tail ? (
                    <Button variant="secondary" size="sm" onClick={() => doCopy(tail, '综合评价与建议')}>
                      复制综合评价与建议
                    </Button>
                  ) : null}
                </div>

                {/* 总体评价等级 */}
                <div>
                  <p className="mb-2 text-sm font-medium text-slate-700">总体评价等级</p>
                  <div className="flex flex-wrap gap-2">
                    {OVERALL_GRADES.map((g) => {
                      const on = form.overallGrade === g.value;
                      return (
                        <button
                          key={g.value}
                          type="button"
                          onClick={() => set('overallGrade', on ? '' : g.value)}
                          className={
                            'rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 transition-colors ' +
                            (on
                              ? 'bg-brand-50 text-brand-700 ring-brand-300'
                              : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50')
                          }
                        >
                          {g.label}
                        </button>
                      );
                    })}
                  </div>
                  {reportAt ? (
                    <p className="mt-2 text-xs text-slate-400">报告生成于 {relativeTime(reportAt)}</p>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="p-5 text-sm text-slate-400">
                还没有评课报告。填写上方的听课记录（或点语音口述），再点「AI 生成评课」。
              </div>
            )}
          </Card>

          {/* ===== 反馈与状态 ===== */}
          <Card>
            <CardHeader title="反馈与状态" description="评课给老师后的反馈状态与老师回应（可选，用于闭环）" />
            <div className="space-y-4 p-5">
              <Select
                label="状态"
                value={form.status}
                onChange={(e) => set('status', e.target.value)}
                options={OBSERVATION_STATUS.map((s) => ({ value: s.value, label: s.label }))}
              />
              <Textarea
                label="老师回应 / 改进措施（选填）"
                rows={3}
                value={form.teacherReply}
                onChange={(e) => set('teacherReply', e.target.value)}
                placeholder="记录老师对评课的回应或后续改进动作"
              />
            </div>
          </Card>

          {/* ===== 操作栏 ===== */}
          <div className="flex items-center justify-end gap-3">
            <Button variant="outline" onClick={() => navigate('/observations')}>
              返回列表
            </Button>
            <Button variant="gradient" icon={<Save className="h-4 w-4" />} loading={saving} onClick={handleSave}>
              {isNew ? '保存记录' : '保存修改'}
            </Button>
          </div>

          {form.overallGrade ? (
            <p className="pb-2 text-right text-xs text-slate-400">
              当前等级：{overallGradeLabel(form.overallGrade)}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
