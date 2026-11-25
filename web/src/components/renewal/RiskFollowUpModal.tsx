import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { RiskStudentRow } from '../../lib/renewal';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Input, Select, Textarea } from '../ui/Field';

export type FollowUpStatus = 'pending' | 'contacted' | 'committed' | 'renewed' | 'closed';
export interface RiskFollowUpRecord {
  reportId: number;
  studentKey: string;
  owner: string;
  followUpStatus: FollowUpStatus;
  nextFollowUpDate: string | null;
  outcome: string | null;
  updatedAt?: string;
}

const STATUS_OPTIONS = [
  { value: 'pending', label: '待联系' },
  { value: 'contacted', label: '已联系' },
  { value: 'committed', label: '已承诺续费' },
  { value: 'renewed', label: '已续费' },
  { value: 'closed', label: '已关闭' },
];

export default function RiskFollowUpModal({ open, student, reportId, record, onClose, onSaved }: {
  open: boolean;
  student: RiskStudentRow | null;
  reportId: number | null;
  record?: RiskFollowUpRecord | null;
  onClose: () => void;
  onSaved: (record: RiskFollowUpRecord) => void;
}) {
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState<FollowUpStatus>('pending');
  const [nextDate, setNextDate] = useState('');
  const [outcome, setOutcome] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setOwner(record?.owner || '');
    setStatus(record?.followUpStatus || 'pending');
    setNextDate(record?.nextFollowUpDate || '');
    setOutcome(record?.outcome || '');
    setError('');
  }, [open, record, student?.studentKey]);

  async function save() {
    if (!student || !reportId || !owner.trim()) {
      setError('请填写跟进负责人');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await api.put(`/renewal/risk-followups/${encodeURIComponent(student.studentKey)}?reportId=${reportId}`, {
        owner: owner.trim(),
        followUpStatus: status,
        nextFollowUpDate: nextDate || null,
        outcome: outcome.trim() || null,
      }) as { record: RiskFollowUpRecord };
      onSaved(response.record);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '跟进记录保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={student ? `跟进 ${student.studentName}` : '学生跟进'}
      description="记录负责人、下一次跟进时间和真实处置结果；不会改写 Excel 原始续费状态。"
      footer={<><Button variant="outline" onClick={onClose}>取消</Button><Button loading={saving} onClick={save}>保存跟进</Button></>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm">
          <div><span className="text-slate-400">学管：</span><span className="text-slate-700">{student?.managerName || '未分配'}</span></div>
          <div><span className="text-slate-400">年级：</span><span className="text-slate-700">{student?.grade || '—'}</span></div>
          <div><span className="text-slate-400">上月课消：</span><span className="text-slate-700">{student?.classLast1 ?? '—'}</span></div>
          <div><span className="text-slate-400">上两月课消：</span><span className="text-slate-700">{student?.classLast2 ?? '—'}</span></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="跟进负责人" required value={owner} onChange={(event) => setOwner(event.target.value)} maxLength={80} placeholder="填写负责人姓名" />
          <Select label="跟进状态" options={STATUS_OPTIONS} value={status} onChange={(event) => setStatus(event.target.value as FollowUpStatus)} />
        </div>
        <Input label="下次跟进日期" type="date" value={nextDate} onChange={(event) => setNextDate(event.target.value)} />
        <Textarea label="沟通与处置记录" rows={5} value={outcome} onChange={(event) => setOutcome(event.target.value)} maxLength={2000} placeholder="记录家长反馈、异议、承诺和下一步动作" />
        {error && <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
      </div>
    </Modal>
  );
}
