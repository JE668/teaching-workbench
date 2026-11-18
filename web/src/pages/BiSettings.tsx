import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/ui/Toast';

type Tab = 'overrides' | 'incentive' | 'teacher' | 'mentor';

interface Override {
  id: number; scope: string; key_type: string; key_value: string;
  indicator: string; override_value: string; reason: string | null;
  effective_from: string | null; effective_to: string | null;
}
interface Incentive {
  id: number; scope: string; scope_value: string; target_rate: number;
  effective_from: string; effective_to: string | null;
}
interface TeacherMap {
  id: number; teacher_no: string; teacher_name: string | null;
  student_id: string; student_name: string | null;
  is_prepaid: number; prepaid_overridden: number; grade: string | null; note: string | null;
}
interface MentorMap {
  id: number; mentor_no: string; mentor_name: string | null;
  student_id: string; student_name: string | null;
  grade: string | null; note: string | null;
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'overrides', label: '指标覆盖规则' },
  { key: 'incentive', label: '激励目标比例' },
  { key: 'teacher', label: '老师-学生映射' },
  { key: 'mentor', label: '学管-学生映射' },
];

const OVERRIDE_SCOPES = ['student', 'teacher', 'mentor', 'subject_group', 'learning_center'];
const INCENTIVE_SCOPES = ['mentor', 'branch_company', 'subject_group', 'grade_stage', 'learning_center'];

export default function BiSettings() {
  const [tab, setTab] = useState<Tab>('overrides');
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [incentives, setIncentives] = useState<Incentive[]>([]);
  const [teachers, setTeachers] = useState<TeacherMap[]>([]);
  const [mentors, setMentors] = useState<MentorMap[]>([]);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  // 表单状态：用空对象表示"新增"，{id,...} 表示编辑
  const [editOverride, setEditOverride] = useState<Partial<Override> | null>(null);
  const [editIncentive, setEditIncentive] = useState<Partial<Incentive> | null>(null);
  const [editTeacher, setEditTeacher] = useState<Partial<TeacherMap> | null>(null);
  const [editMentor, setEditMentor] = useState<Partial<MentorMap> | null>(null);

  useEffect(() => { void load(); }, [tab]);

  async function load() {
    setLoading(true);
    try {
      if (tab === 'overrides') {
        const res = await api.get('/bi/indicator-overrides');
        setOverrides(res.overrides ?? []);
      } else if (tab === 'incentive') {
        const res = await api.get('/bi/incentive-settings');
        setIncentives(res.settings ?? []);
      } else if (tab === 'teacher') {
        const res = await api.get('/bi/teacher-students');
        setTeachers(res.teachers ?? []);
      } else {
        const res = await api.get('/bi/mentor-students');
        setMentors(res.mentors ?? []);
      }
    } catch (err) {
      toast.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  }

  async function del(path: string) {
    if (!confirm('确认删除？')) return;
    try {
      await api.delete(path);
      toast.success('已删除');
      await load();
    } catch (err) {
      toast.error('删除失败');
    }
  }

  async function saveOverride() {
    if (!editOverride) return;
    try {
      const body = {
        scope: editOverride.scope ?? 'student',
        key_type: editOverride.key_type ?? '',
        key_value: editOverride.key_value ?? '',
        indicator: editOverride.indicator ?? '',
        override_value: editOverride.override_value ?? '',
        reason: editOverride.reason ?? undefined,
        effective_from: editOverride.effective_from || undefined,
        effective_to: editOverride.effective_to || null,
      };
      if (editOverride.id) await api.patch(`/bi/indicator-overrides/${editOverride.id}`, body);
      else await api.post('/bi/indicator-overrides', body);
      toast.success('已保存');
      setEditOverride(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message ?? '保存失败');
    }
  }

  async function saveIncentive() {
    if (!editIncentive) return;
    try {
      const body = {
        scope: editIncentive.scope ?? 'mentor',
        scope_value: editIncentive.scope_value ?? '',
        target_rate: Number(editIncentive.target_rate ?? 0) / 100,
        effective_from: editIncentive.effective_from ?? new Date().toISOString().slice(0, 10),
        effective_to: editIncentive.effective_to || null,
      };
      if (editIncentive.id) await api.patch(`/bi/incentive-settings/${editIncentive.id}`, body);
      else await api.post('/bi/incentive-settings', body);
      toast.success('已保存');
      setEditIncentive(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message ?? '保存失败');
    }
  }

  async function saveTeacher() {
    if (!editTeacher) return;
    try {
      const body = {
        teacher_no: editTeacher.teacher_no ?? '',
        teacher_name: editTeacher.teacher_name ?? undefined,
        student_id: editTeacher.student_id ?? '',
        student_name: editTeacher.student_name ?? undefined,
        grade: editTeacher.grade ?? undefined,
        note: editTeacher.note ?? undefined,
        ...(editTeacher.id ? {} : { is_prepaid: editTeacher.is_prepaid ? 1 : 0 }),
      };
      if (editTeacher.id) await api.patch(`/bi/teacher-students/${editTeacher.id}`, body);
      else await api.post('/bi/teacher-students', body);
      toast.success('已保存');
      setEditTeacher(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message ?? '保存失败');
    }
  }

  async function saveMentor() {
    if (!editMentor) return;
    try {
      const body = {
        mentor_no: editMentor.mentor_no ?? '',
        mentor_name: editMentor.mentor_name ?? undefined,
        student_id: editMentor.student_id ?? '',
        student_name: editMentor.student_name ?? undefined,
        grade: editMentor.grade ?? undefined,
        note: editMentor.note ?? undefined,
      };
      if (editMentor.id) await api.patch(`/bi/mentor-students/${editMentor.id}`, body);
      else await api.post('/bi/mentor-students', body);
      toast.success('已保存');
      setEditMentor(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message ?? '保存失败');
    }
  }

  const inputCls = 'mt-1 block w-full rounded-md border-slate-300 shadow-sm text-sm focus:border-brand-500 focus:ring-brand-500';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">BI 配置</h1>
        <p className="mt-1 text-sm text-slate-600">指标覆盖规则 / 激励目标比例 / 老师-学管-学生映射表维护。</p>
      </div>

      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-8">
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`py-2 px-1 border-b-2 text-sm font-medium ${tab === key
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}>
              {label}
            </button>
          ))}
        </nav>
      </div>

      {loading && <div className="py-8 text-center text-sm text-slate-500">加载中…</div>}

      {!loading && tab === 'overrides' && (
        <div>
          <button onClick={() => setEditOverride({})}
            className="mb-3 rounded bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700">新增覆盖规则</button>
          <table className="min-w-full divide-y divide-slate-200 border">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">scope</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">key_type</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">key_value</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">indicator</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">override</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">reason</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {overrides.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">暂无覆盖规则</td></tr>
              ) : overrides.map(o => (
                <tr key={o.id}>
                  <td className="px-3 py-2 text-sm">{o.scope}</td>
                  <td className="px-3 py-2 text-sm">{o.key_type}</td>
                  <td className="px-3 py-2 text-sm">{o.key_value}</td>
                  <td className="px-3 py-2 text-sm">{o.indicator}</td>
                  <td className="px-3 py-2 text-sm font-semibold">{o.override_value}</td>
                  <td className="px-3 py-2 text-sm text-slate-600">{o.reason ?? '-'}</td>
                  <td className="px-3 py-2 text-right text-sm space-x-2">
                    <button onClick={() => setEditOverride(o)} className="text-brand-600 underline">编辑</button>
                    <button onClick={() => del(`/bi/indicator-overrides/${o.id}`)} className="text-red-600 underline">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {editOverride && (
            <div className="mt-4 rounded-lg border p-4 bg-white shadow-sm">
              <h3 className="text-sm font-medium mb-2">{editOverride.id ? '编辑' : '新增'}覆盖规则</h3>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs">scope
                  <select className={inputCls} value={editOverride.scope ?? 'student'}
                    onChange={e => setEditOverride({ ...editOverride, scope: e.target.value })}>
                    {OVERRIDE_SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="block text-xs">key_type
                  <input className={inputCls} value={editOverride.key_type ?? ''}
                    onChange={e => setEditOverride({ ...editOverride, key_type: e.target.value })} />
                </label>
                <label className="block text-xs">key_value（如：学管师姓名）
                  <input className={inputCls} value={editOverride.key_value ?? ''}
                    onChange={e => setEditOverride({ ...editOverride, key_value: e.target.value })} />
                </label>
                <label className="block text-xs">indicator（如：xusheng_rate）
                  <input className={inputCls} value={editOverride.indicator ?? ''}
                    onChange={e => setEditOverride({ ...editOverride, indicator: e.target.value })} />
                </label>
                <label className="block text-xs">override_value
                  <input className={inputCls} value={editOverride.override_value ?? ''}
                    onChange={e => setEditOverride({ ...editOverride, override_value: e.target.value })} />
                </label>
                <label className="block text-xs">reason
                  <input className={inputCls} value={editOverride.reason ?? ''}
                    onChange={e => setEditOverride({ ...editOverride, reason: e.target.value })} />
                </label>
                <label className="block text-xs">effective_from
                  <input type="date" className={inputCls} value={editOverride.effective_from ?? ''}
                    onChange={e => setEditOverride({ ...editOverride, effective_from: e.target.value })} />
                </label>
                <label className="block text-xs">effective_to
                  <input type="date" className={inputCls} value={editOverride.effective_to ?? ''}
                    onChange={e => setEditOverride({ ...editOverride, effective_to: e.target.value })} />
                </label>
              </div>
              <div className="mt-3 space-x-2">
                <button onClick={saveOverride} className="rounded bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700">保存</button>
                <button onClick={() => setEditOverride(null)} className="rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-700">取消</button>
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'incentive' && (
        <div>
          <button onClick={() => setEditIncentive({})}
            className="mb-3 rounded bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700">新增目标比例</button>
          <table className="min-w-full divide-y divide-slate-200 border">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">scope</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">对象</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">目标比例</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">生效起</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">生效止</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {incentives.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">暂无激励目标</td></tr>
              ) : incentives.map(i => (
                <tr key={i.id}>
                  <td className="px-3 py-2 text-sm">{i.scope}</td>
                  <td className="px-3 py-2 text-sm">{i.scope_value}</td>
                  <td className="px-3 py-2 text-sm text-right font-semibold">{(i.target_rate * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2 text-sm">{i.effective_from}</td>
                  <td className="px-3 py-2 text-sm">{i.effective_to ?? '永久'}</td>
                  <td className="px-3 py-2 text-right text-sm space-x-2">
                    <button onClick={() => setEditIncentive({ ...i, target_rate: i.target_rate * 100 })} className="text-brand-600 underline">编辑</button>
                    <button onClick={() => del(`/bi/incentive-settings/${i.id}`)} className="text-red-600 underline">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {editIncentive && (
            <div className="mt-4 rounded-lg border p-4 bg-white shadow-sm">
              <h3 className="text-sm font-medium mb-2">{editIncentive.id ? '编辑' : '新增'}激励目标</h3>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs">scope
                  <select className={inputCls} value={editIncentive.scope ?? 'mentor'}
                    onChange={e => setEditIncentive({ ...editIncentive, scope: e.target.value })}>
                    {INCENTIVE_SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="block text-xs">对象（学管/科组/分公司）
                  <input className={inputCls} value={editIncentive.scope_value ?? ''}
                    onChange={e => setEditIncentive({ ...editIncentive, scope_value: e.target.value })} />
                </label>
                <label className="block text-xs">目标比例（%）例如 80 表示 80%
                  <input type="number" className={inputCls} value={editIncentive.target_rate ?? 80}
                    onChange={e => setEditIncentive({ ...editIncentive, target_rate: Number(e.target.value) })} />
                </label>
                <label className="block text-xs">生效起
                  <input type="date" className={inputCls} value={editIncentive.effective_from ?? ''}
                    onChange={e => setEditIncentive({ ...editIncentive, effective_from: e.target.value })} />
                </label>
                <label className="block text-xs">生效止（留空=永久）
                  <input type="date" className={inputCls} value={editIncentive.effective_to ?? ''}
                    onChange={e => setEditIncentive({ ...editIncentive, effective_to: e.target.value })} />
                </label>
              </div>
              <p className="mt-2 text-xs text-slate-500">提示：输入 80 表示 80%（存入数据库为 0.80）。</p>
              <div className="mt-3 space-x-2">
                <button onClick={saveIncentive} className="rounded bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700">保存</button>
                <button onClick={() => setEditIncentive(null)} className="rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-700">取消</button>
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'teacher' && (
        <div>
          <button onClick={() => setEditTeacher({})}
            className="mb-3 rounded bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700">新增映射</button>
          <table className="min-w-full divide-y divide-slate-200 border">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">老师工号</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">老师姓名</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">学生ID</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">学生姓名</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">预存</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {teachers.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">暂无映射</td></tr>
              ) : teachers.map(t => (
                <tr key={t.id}>
                  <td className="px-3 py-2 text-sm">{t.teacher_no}</td>
                  <td className="px-3 py-2 text-sm">{t.teacher_name ?? '-'}</td>
                  <td className="px-3 py-2 text-sm">{t.student_id}</td>
                  <td className="px-3 py-2 text-sm">{t.student_name ?? '-'}</td>
                  <td className="px-3 py-2 text-sm">
                    {t.is_prepaid ? <span className="text-green-600">是{t.prepaid_overridden ? '（人工）' : ''}</span> : <span className="text-slate-400">否</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-sm space-x-2">
                    <button onClick={() => setEditTeacher(t)} className="text-brand-600 underline">编辑</button>
                    <button onClick={() => del(`/bi/teacher-students/${t.id}`)} className="text-red-600 underline">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {editTeacher && (
            <div className="mt-4 rounded-lg border p-4 bg-white shadow-sm">
              <h3 className="text-sm font-medium mb-2">{editTeacher.id ? '编辑' : '新增'}老师-学生映射</h3>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs">老师工号 *
                  <input className={inputCls} value={editTeacher.teacher_no ?? ''}
                    onChange={e => setEditTeacher({ ...editTeacher, teacher_no: e.target.value })} />
                </label>
                <label className="block text-xs">老师姓名
                  <input className={inputCls} value={editTeacher.teacher_name ?? ''}
                    onChange={e => setEditTeacher({ ...editTeacher, teacher_name: e.target.value })} />
                </label>
                <label className="block text-xs">学生ID *
                  <input className={inputCls} value={editTeacher.student_id ?? ''}
                    onChange={e => setEditTeacher({ ...editTeacher, student_id: e.target.value })} />
                </label>
                <label className="block text-xs">学生姓名
                  <input className={inputCls} value={editTeacher.student_name ?? ''}
                    onChange={e => setEditTeacher({ ...editTeacher, student_name: e.target.value })} />
                </label>
                <label className="block text-xs">年级
                  <input className={inputCls} value={editTeacher.grade ?? ''}
                    onChange={e => setEditTeacher({ ...editTeacher, grade: e.target.value })} />
                </label>
                {!editTeacher.id && (
                  <label className="block text-xs flex items-center gap-2 mt-6">
                    <input type="checkbox" checked={!!editTeacher.is_prepaid}
                      onChange={e => setEditTeacher({ ...editTeacher, is_prepaid: e.target.checked ? 1 : 0 })} />
                    <span>是否预存</span>
                  </label>
                )}
                <label className="block text-xs col-span-2">备注
                  <input className={inputCls} value={editTeacher.note ?? ''}
                    onChange={e => setEditTeacher({ ...editTeacher, note: e.target.value })} />
                </label>
              </div>
              {editTeacher.id && <p className="mt-2 text-xs text-slate-500">编辑已存在记录的「预存」字段请通过"对账视图"页面进行，避免误改人工覆盖标记。</p>}
              <div className="mt-3 space-x-2">
                <button onClick={saveTeacher} className="rounded bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700">保存</button>
                <button onClick={() => setEditTeacher(null)} className="rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-700">取消</button>
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'mentor' && (
        <div>
          <button onClick={() => setEditMentor({})}
            className="mb-3 rounded bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700">新增映射</button>
          <table className="min-w-full divide-y divide-slate-200 border">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">学管工号</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">学管姓名</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">学生ID</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">学生姓名</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {mentors.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">暂无映射</td></tr>
              ) : mentors.map(m => (
                <tr key={m.id}>
                  <td className="px-3 py-2 text-sm">{m.mentor_no}</td>
                  <td className="px-3 py-2 text-sm">{m.mentor_name ?? '-'}</td>
                  <td className="px-3 py-2 text-sm">{m.student_id}</td>
                  <td className="px-3 py-2 text-sm">{m.student_name ?? '-'}</td>
                  <td className="px-3 py-2 text-right text-sm space-x-2">
                    <button onClick={() => setEditMentor(m)} className="text-brand-600 underline">编辑</button>
                    <button onClick={() => del(`/bi/mentor-students/${m.id}`)} className="text-red-600 underline">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {editMentor && (
            <div className="mt-4 rounded-lg border p-4 bg-white shadow-sm">
              <h3 className="text-sm font-medium mb-2">{editMentor.id ? '编辑' : '新增'}学管-学生映射</h3>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs">学管工号 *
                  <input className={inputCls} value={editMentor.mentor_no ?? ''}
                    onChange={e => setEditMentor({ ...editMentor, mentor_no: e.target.value })} />
                </label>
                <label className="block text-xs">学管姓名
                  <input className={inputCls} value={editMentor.mentor_name ?? ''}
                    onChange={e => setEditMentor({ ...editMentor, mentor_name: e.target.value })} />
                </label>
                <label className="block text-xs">学生ID *
                  <input className={inputCls} value={editMentor.student_id ?? ''}
                    onChange={e => setEditMentor({ ...editMentor, student_id: e.target.value })} />
                </label>
                <label className="block text-xs">学生姓名
                  <input className={inputCls} value={editMentor.student_name ?? ''}
                    onChange={e => setEditMentor({ ...editMentor, student_name: e.target.value })} />
                </label>
                <label className="block text-xs">年级
                  <input className={inputCls} value={editMentor.grade ?? ''}
                    onChange={e => setEditMentor({ ...editMentor, grade: e.target.value })} />
                </label>
                <label className="block text-xs">备注
                  <input className={inputCls} value={editMentor.note ?? ''}
                    onChange={e => setEditMentor({ ...editMentor, note: e.target.value })} />
                </label>
              </div>
              <div className="mt-3 space-x-2">
                <button onClick={saveMentor} className="rounded bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700">保存</button>
                <button onClick={() => setEditMentor(null)} className="rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-700">取消</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
