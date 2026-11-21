import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Card, CardHeader } from './ui/Card';
import Button from './ui/Button';
import { Input, Select, Textarea } from './ui/Field';
import { useToast } from './ui/Toast';
import {
  StudentProfile,
  StudentProfileListItem,
  LEARNING_STYLE_LABELS,
  PACING_PREFERENCE_LABELS,
  COMMUNICATION_STYLE_LABELS,
  HOMEWORK_COMPLIANCE_LABELS,
  PARENTAL_INVOLVEMENT_LABELS,
  EntityType,
} from '../types/index';
import {
  Brain,
  Zap,
  Heart,
  Target,
  MessageSquare,
  Clock,
  CheckCircle,
  AlertCircle,
  Users,
  RefreshCw,
  Edit2,
  Eye,
  Loader2,
} from 'lucide-react';

interface StudentProfilePanelProps {
  studentId: number;
  studentName: string;
  entityType?: EntityType;
  entityId?: number;
}

export function StudentProfilePanel({
  studentId,
  studentName,
  entityType,
  entityId,
}: StudentProfilePanelProps) {
  const toast = useToast();
  const [profile, setProfile] = useState<StudentProfileListItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<StudentProfile>>({});

  // 加载现有画像
  const loadProfile = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/student-profiles/${studentId}`);
      if (res.profile) {
        setProfile(res.profile);
        setFormData(res.profile.profile);
      }
    } catch (error: any) {
      if (error.message.includes('404')) {
        setProfile(null);
      } else {
        toast.error('加载学生画像失败：' + error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, [studentId]);

  // 生成/重新生成画像
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await api.post(`/student-profiles/${studentId}/generate`, {});
      setProfile(res.profile);
      setFormData(res.profile.profile);
      toast.success('学生画像生成完成');
      if (entityType && entityId) {
        try {
          await api.post('/content/references', {
            sourceType: 'student_profile' as EntityType,
            sourceId: res.profile.id,
            targetType: entityType,
            targetId: entityId,
            refRole: 'derives_from',
          });
        } catch (referenceError: any) {
          // 画像已保存；明确告知引用失败，避免把部分成功静默伪装成完整成功。
          toast.error('画像已生成，但内容引用创建失败：' + referenceError.message);
        }
      }
    } catch (error: any) {
      toast.error('生成学生画像失败：' + error.message);
    } finally {
      setGenerating(false);
    }
  };

  // 更新画像（教师确认/微调）
  const handleSave = async () => {
    try {
      const res = await api.patch(`/student-profiles/${studentId}`, formData);
      setProfile(res.profile);
      setFormData(res.profile.profile);
      setEditing(false);
      toast.success('学生画像已更新');
    } catch (error: any) {
      toast.error('更新失败：' + error.message);
    }
  };

  // 切换编辑模式
  const startEdit = () => {
    if (profile) {
      setFormData(profile.profile);
      setEditing(true);
    }
  };

  const cancelEdit = () => {
    if (profile) {
      setFormData(profile.profile);
    }
    setEditing(false);
  };

  if (loading) {
    return (
      <Card>
        <div className="p-8 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载学生画像…
        </div>
      </Card>
    );
  }

  // 无画像时显示生成引导
  if (!profile) {
    return (
      <Card>
        <CardHeader
          title={`${studentName} 的学生画像`}
          description="聚合回访、月报、听评课、知识图谱、错因分析等多模态数据，由 AI 生成结构化画像"
          icon={<Brain className="h-4 w-4" />}
        />
        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600 space-y-2">
            <p>暂无该学生的画像数据。</p>
            <p className="text-xs text-slate-400">
              点击下方按钮，系统将聚合该学生近 6 个月的所有教学数据（回访、月报、听评课、知识点掌握、错因分析），
              由 AI 生成包含学习风格、强弱项、动机驱动、节奏偏好、沟通风格、专注时长、作业配合度、家长参与度等维度的结构化画像。
            </p>
          </div>
          <Button
            variant="gradient"
            icon={<Zap className="h-4 w-4" />}
            loading={generating}
            onClick={handleGenerate}
            className="w-full"
          >
            {generating ? 'AI 生成中…' : '生成学生画像'}
          </Button>
        </div>
      </Card>
    );
  }

  // 显示画像详情
  const profileData = profile.profile;

  return (
    <Card>
      <CardHeader
        title={`${studentName} 的学生画像`}
        description={profile.sourceSummary}
        icon={<Brain className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={editing ? <CheckCircle className="h-3.5 w-3.5" /> : <Edit2 className="h-3.5 w-3.5" />}
              onClick={editing ? handleSave : startEdit}
            >
              {editing ? '保存' : '编辑'}
            </Button>
            {editing && (
              <Button variant="ghost" size="sm" icon={<Eye className="h-3.5 w-3.5" />} onClick={cancelEdit}>
                取消
              </Button>
            )}
            {!editing && (
              <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={generating} onClick={handleGenerate}>
                重新生成
              </Button>
            )}
            {!editing && profile.confirmedByTeacher && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs">
                <CheckCircle className="h-3 w-3" />
                教师已确认
              </span>
            )}
          </div>
        }
      />

      <div className="p-5 space-y-5">
        {/* 置信度指示器 */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all duration-500"
              style={{ width: `${Math.round(profile.confidence * 100)}%` }}
            />
          </div>
          <span className="text-sm font-medium text-slate-600">
            画像可信度: {Math.round(profile.confidence * 100)}%
          </span>
          <span className="text-xs text-slate-400">生成于 {new Date(profile.generatedAt).toLocaleString()}</span>
        </div>

        {/* 教师备注 */}
        {profile.teacherNotes && (
          <div className="rounded-lg bg-amber-50 border border-amber-100 p-3">
            <div className="flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <span className="font-medium text-amber-800">教师备注：</span>
              <span className="text-amber-700">{profile.teacherNotes}</span>
            </div>
          </div>
        )}

        {/* 核心维度网格 */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ProfileDimensionCard
            icon={<Brain className="h-5 w-5" />}
            title="学习风格"
            value={LEARNING_STYLE_LABELS[profileData.learning_style]}
            color="blue"
            editing={editing}
            formData={formData}
            setFormData={setFormData}
            field="learning_style"
            options={Object.entries(LEARNING_STYLE_LABELS).map(([value, label]: [string, string]) => ({ value, label }))}
          />
          <ProfileDimensionCard
            icon={<Zap className="h-5 w-5" />}
            title="节奏偏好"
            value={PACING_PREFERENCE_LABELS[profileData.pacing_preference]}
            color="purple"
            editing={editing}
            formData={formData}
            setFormData={setFormData}
            field="pacing_preference"
            options={Object.entries(PACING_PREFERENCE_LABELS).map(([value, label]: [string, string]) => ({ value, label }))}
          />
          <ProfileDimensionCard
            icon={<MessageSquare className="h-5 w-5" />}
            title="沟通风格"
            value={COMMUNICATION_STYLE_LABELS[profileData.communication_style]}
            color="green"
            editing={editing}
            formData={formData}
            setFormData={setFormData}
            field="communication_style"
            options={Object.entries(COMMUNICATION_STYLE_LABELS).map(([value, label]: [string, string]) => ({ value, label }))}
          />
          <ProfileDimensionCard
            icon={<Clock className="h-5 w-5" />}
            title="专注时长"
            value={`${profileData.attention_span_minutes} 分钟`}
            color="orange"
            editing={editing}
            formData={formData}
            setFormData={setFormData}
            field="attention_span_minutes"
            type="number"
            min={10}
            max={120}
          />
        </div>

        {/* 行为维度网格 */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ProfileDimensionCard
            icon={<CheckCircle className="h-5 w-5" />}
            title="作业配合度"
            value={HOMEWORK_COMPLIANCE_LABELS[profileData.homework_compliance]}
            color="indigo"
            editing={editing}
            formData={formData}
            setFormData={setFormData}
            field="homework_compliance"
            options={Object.entries(HOMEWORK_COMPLIANCE_LABELS).map(([value, label]: [string, string]) => ({ value, label }))}
          />
          <ProfileDimensionCard
            icon={<Users className="h-5 w-5" />}
            title="家长参与度"
            value={PARENTAL_INVOLVEMENT_LABELS[profileData.parental_involvement]}
            color="pink"
            editing={editing}
            formData={formData}
            setFormData={setFormData}
            field="parental_involvement"
            options={Object.entries(PARENTAL_INVOLVEMENT_LABELS).map(([value, label]: [string, string]) => ({ value, label }))}
          />
          <ProfileDimensionCard
            icon={<Target className="h-5 w-5" />}
            title="动机驱动"
            value={profileData.motivation_drivers.join('、') || '—'}
            color="teal"
            editing={editing}
            formData={formData}
            setFormData={setFormData}
            field="motivation_drivers"
            type="text"
            placeholder="用顿号分隔，如：竞赛排名、老师表扬、内驱力"
            isArray={true}
          />
          <ProfileDimensionCard
            icon={<Heart className="h-5 w-5" />}
            title="自信心水平"
            value={`${Math.round(profileData.confidence * 100)}%`}
            color="rose"
            editing={editing}
            formData={formData}
            setFormData={setFormData}
            field="confidence"
            type="number"
            min={0}
            max={1}
            step={0.1}
          />
        </div>

        {/* 强弱项详情 */}
        <div className="grid gap-4 sm:grid-cols-2">
          <ProfileListCard
            icon={<Target className="h-5 w-5 text-green-500" />}
            title="强项"
            items={profileData.strong_points}
            color="green"
            editing={editing}
            formData={formData}
            setFormData={setFormData}
            field="strong_points"
          />
          <ProfileListCard
            icon={<AlertCircle className="h-5 w-5 text-red-500" />}
            title="弱点/关注点"
            items={profileData.weak_points}
            color="red"
            editing={editing}
            formData={formData}
            setFormData={setFormData}
            field="weak_points"
          />
        </div>

        {/* 更新时间 */}
        <p className="text-xs text-slate-400 text-right">
          画像更新于 {new Date(profile.generatedAt).toLocaleString()}
          {profile.confirmedByTeacher && ' · 已由教师确认'}
        </p>
      </div>
    </Card>
  );
}

// 单维度卡片组件
interface ProfileDimensionCardProps {
  icon: React.ReactNode;
  title: string;
  value: string;
  color: string;
  editing: boolean;
  formData: Partial<StudentProfile>;
  setFormData: (data: Partial<StudentProfile>) => void;
  field: keyof StudentProfile;
  options?: { value: string; label: string }[];
  type?: 'text' | 'number';
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  isArray?: boolean;
}

function ProfileDimensionCard({
  icon,
  title,
  value,
  color,
  editing,
  formData,
  setFormData,
  field,
  options,
  type = 'text',
  min,
  max,
  step,
  placeholder,
  isArray,
}: ProfileDimensionCardProps) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    purple: 'bg-purple-50 text-purple-700 border-purple-100',
    green: 'bg-green-50 text-green-700 border-green-100',
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    pink: 'bg-pink-50 text-pink-700 border-pink-100',
    teal: 'bg-teal-50 text-teal-700 border-teal-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
  };

  const cls = colorClasses[color] || 'bg-slate-50 text-slate-700 border-slate-100';

  if (!editing) {
    return (
      <div className={`rounded-xl border ${cls} p-4`}>
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${cls.replace('50', '100').replace('700', '600')}`}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-400 uppercase tracking-wider">{title}</p>
            <p className="font-medium text-slate-800 truncate">{value}</p>
          </div>
        </div>
      </div>
    );
  }

  // 编辑模式
  if (isArray) {
    const currentValue = (formData[field] as string[])?.join('、') || '';
    return (
      <div className={`rounded-xl border ${cls} p-4`}>
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${cls.replace('50', '100').replace('700', '600')}`}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">{title}</p>
            <Input
              value={currentValue}
              onChange={(e) => setFormData({ ...formData, [field]: e.target.value.split('、').filter(Boolean) })}
              placeholder={placeholder}
              className="text-sm"
            />
          </div>
        </div>
      </div>
    );
  }

  if (options) {
    const currentValue = formData[field] as string;
    return (
      <div className={`rounded-xl border ${cls} p-4`}>
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${cls.replace('50', '100').replace('700', '600')}`}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">{title}</p>
            <Select
              value={currentValue}
              onChange={(e) => setFormData({ ...formData, [field]: e.target.value })}
              options={options}
              placeholder="请选择"
              className="text-sm"
            />
          </div>
        </div>
      </div>
    );
  }

  const currentValue = formData[field] as string | number;
  return (
    <div className={`rounded-xl border ${cls} p-4`}>
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${cls.replace('50', '100').replace('700', '600')}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">{title}</p>
          <Input
            type={type}
            value={currentValue}
            onChange={(e) => {
              const val = type === 'number' ? parseFloat(e.target.value) : e.target.value;
              setFormData({ ...formData, [field]: val });
            }}
            min={min}
            max={max}
            step={step}
            placeholder={placeholder}
            className="text-sm"
          />
        </div>
      </div>
    </div>
  );
}

// 列表型卡片组件（强项/弱点）
interface ProfileListCardProps {
  icon: React.ReactNode;
  title: string;
  items: string[];
  color: string;
  editing: boolean;
  formData: Partial<StudentProfile>;
  setFormData: (data: Partial<StudentProfile>) => void;
  field: keyof StudentProfile;
}

function ProfileListCard({
  icon,
  title,
  items,
  color,
  editing,
  formData,
  setFormData,
  field,
}: ProfileListCardProps) {
  const colorClasses: Record<string, string> = {
    green: 'bg-green-50 text-green-700 border-green-100',
    red: 'bg-red-50 text-red-700 border-red-100',
  };

  const cls = colorClasses[color] || 'bg-slate-50 text-slate-700 border-slate-100';

  if (!editing) {
    return (
      <div className={`rounded-xl border ${cls} p-4`}>
        <div className="flex items-center gap-2 mb-3">
          {icon}
          <h4 className="font-medium text-slate-800">{title}</h4>
        </div>
        <div className="flex flex-wrap gap-2">
          {items.length > 0 ? (
            items.map((item, idx) => (
              <span key={idx} className={`px-2.5 py-1 rounded-full text-xs ${cls.replace('50', '100').replace('700', '600')}`}>
                {item}
              </span>
            ))
          ) : (
            <span className="text-sm text-slate-400">暂无</span>
          )}
        </div>
      </div>
    );
  }

  // 编辑模式：使用 Textarea 输入，每行一项
  const currentValue = (formData[field] as string[])?.join('\n') || '';
  return (
    <div className={`rounded-xl border ${cls} p-4`}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h4 className="font-medium text-slate-800">{title}</h4>
      </div>
      <Textarea
        value={currentValue}
        onChange={(e) => setFormData({ ...formData, [field]: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
        rows={4}
        placeholder="每行一项，如：\n数学计算能力强\n逻辑推理清晰"
        className="text-sm"
      />
    </div>
  );
}

export default StudentProfilePanel;
