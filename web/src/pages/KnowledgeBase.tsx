import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Database,
  FileText,
  Lightbulb,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import { Input, Select } from '../components/ui/Field';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { api } from '../api/client';

/** 与 server/src/services/knowledge/vectorStore.ts 的 SearchResult 对齐 */
interface SearchResult {
  id: number;
  subject_group: string;
  source_type: string;
  source_id: number;
  chunk_text: string;
  metadata_json: string | null;
  similarity: number;
  indexed_at: string;
}

interface SimilarStudent {
  student_id: number;
  student_name: string;
  subject_group: string;
  grade: string;
  similarity: number;
  matching_chunks: SearchResult[];
}

interface Digest {
  subject_group: string;
  period: { start: string; end: string };
  key_topics: string[];
  teacher_insights: string[];
  common_challenges: string[];
  recommendations: string[];
}

interface KnowledgeStats {
  subject_group: string;
  total_chunks: number;
  by_source_type: { source_type: string; count: number }[];
  latest_indexed: string | null;
  unique_students: number;
}

interface IndexJobStatus {
  processed: number;
  failed: number;
  skipped: number;
  errors: string[];
}

interface StudentMeta {
  student_id?: number;
  student_name?: string;
}

interface KnowledgeGroup {
  id: number;
  name: string;
  subject_group: string;
  role: 'owner' | 'member' | string;
  member_count: number;
  created_at?: string;
  joined_at?: string;
}

interface KnowledgeGroupMember {
  user_id: number;
  username: string;
  role: 'owner' | 'member' | string;
  joined_at: string;
}

interface OneTimeJoinCode {
  groupId: number;
  code: string;
  kind: 'created' | 'rotated';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeSearchResult(value: unknown): SearchResult | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = numberValue(row.id, NaN);
  const sourceId = numberValue(row.source_id, NaN);
  const chunkText = textValue(row.chunk_text).trim();
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(sourceId) || sourceId <= 0 || !chunkText) return null;
  return {
    id,
    subject_group: textValue(row.subject_group, '未分科'),
    source_type: textValue(row.source_type, 'unknown'),
    source_id: sourceId,
    chunk_text: chunkText,
    metadata_json: typeof row.metadata_json === 'string' ? row.metadata_json : null,
    similarity: numberValue(row.similarity),
    indexed_at: textValue(row.indexed_at),
  };
}

function normalizeSearchResults(value: unknown): SearchResult[] {
  return Array.isArray(value)
    ? value.map(normalizeSearchResult).filter((item): item is SearchResult => item !== null)
    : [];
}

function normalizeSimilarStudents(value: unknown): SimilarStudent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((valueItem) => {
    const row = asRecord(valueItem);
    if (!row) return [];
    const studentId = numberValue(row.student_id, NaN);
    if (!Number.isSafeInteger(studentId) || studentId <= 0) return [];
    return [{
      student_id: studentId,
      student_name: textValue(row.student_name, '未命名学生'),
      subject_group: textValue(row.subject_group, '未分科'),
      grade: textValue(row.grade, '未提供年级'),
      similarity: numberValue(row.similarity),
      matching_chunks: normalizeSearchResults(row.matching_chunks),
    }];
  });
}

function normalizeStats(value: unknown, subjectGroup: string): KnowledgeStats {
  const row = asRecord(value);
  const sourceRows = Array.isArray(row?.by_source_type) ? row.by_source_type : [];
  return {
    subject_group: textValue(row?.subject_group, subjectGroup),
    total_chunks: Math.max(0, numberValue(row?.total_chunks)),
    by_source_type: sourceRows.flatMap((valueItem) => {
      const source = asRecord(valueItem);
      if (!source || typeof source.source_type !== 'string') return [];
      return [{ source_type: source.source_type, count: Math.max(0, numberValue(source.count)) }];
    }),
    latest_indexed: typeof row?.latest_indexed === 'string' ? row.latest_indexed : null,
    unique_students: Math.max(0, numberValue(row?.unique_students)),
  };
}

function normalizeDigest(value: unknown): Digest | null {
  const row = asRecord(value);
  const period = asRecord(row?.period);
  if (!row || !period || typeof row.subject_group !== 'string' ||
      typeof period.start !== 'string' || typeof period.end !== 'string') return null;
  const fields = ['key_topics', 'teacher_insights', 'common_challenges', 'recommendations'] as const;
  if (fields.some((field) => !Array.isArray(row[field]))) return null;
  return {
    subject_group: row.subject_group,
    period: { start: period.start, end: period.end },
    key_topics: (row.key_topics as unknown[]).filter((item): item is string => typeof item === 'string'),
    teacher_insights: (row.teacher_insights as unknown[]).filter((item): item is string => typeof item === 'string'),
    common_challenges: (row.common_challenges as unknown[]).filter((item): item is string => typeof item === 'string'),
    recommendations: (row.recommendations as unknown[]).filter((item): item is string => typeof item === 'string'),
  };
}

function normalizeGroup(value: unknown): KnowledgeGroup | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = numberValue(row.id, NaN);
  if (!Number.isSafeInteger(id) || id <= 0 || typeof row.name !== 'string' || typeof row.subject_group !== 'string') return null;
  return {
    id,
    name: row.name,
    subject_group: row.subject_group,
    role: textValue(row.role, 'member'),
    member_count: Math.max(0, numberValue(row.member_count)),
    created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
    joined_at: typeof row.joined_at === 'string' ? row.joined_at : undefined,
  };
}

function normalizeGroupMember(value: unknown): KnowledgeGroupMember | null {
  const row = asRecord(value);
  if (!row) return null;
  const userId = numberValue(row.user_id, NaN);
  if (!Number.isSafeInteger(userId) || userId <= 0 || typeof row.username !== 'string' || !row.username.trim()) return null;
  return {
    user_id: userId,
    username: row.username,
    role: textValue(row.role, 'member'),
    joined_at: textValue(row.joined_at),
  };
}

function normalizeJob(value: unknown): IndexJobStatus {
  const row = asRecord(value);
  return {
    processed: Math.max(0, numberValue(row?.processed)),
    failed: Math.max(0, numberValue(row?.failed)),
    skipped: Math.max(0, numberValue(row?.skipped)),
    errors: Array.isArray(row?.errors) ? row.errors.filter((item): item is string => typeof item === 'string') : [],
  };
}

const SOURCE_LABELS: Record<string, string> = {
  followup: '课后回访',
  report: '月度报告',
  observation: '听评课',
};

const DEFAULT_GROUPS = ['数学', '语文', '英语', '物理', '化学'];

function parseMeta(raw: string | null): StudentMeta {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed = asRecord(JSON.parse(raw));
    if (!parsed) return {};
    return {
      student_id: typeof parsed.student_id === 'number' && Number.isFinite(parsed.student_id) ? parsed.student_id : undefined,
      student_name: typeof parsed.student_name === 'string' ? parsed.student_name : undefined,
    };
  } catch {
    return {};
  }
}

const SOURCE_TONES: Record<string, 'brand' | 'success' | 'info'> = {
  followup: 'brand',
  report: 'success',
  observation: 'info',
};

function SimilarityBar({ value }: { value: number }) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-500" style={{ width: percent + '%' }} />
      </div>
      <span className="text-xs tabular-nums text-slate-500">{percent}%</span>
    </div>
  );
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-500">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">暂无内容</p>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          {items.map((bulletText, bulletIndex) => (
            <li key={title + '-' + bulletIndex}>{bulletText}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultCard({ item }: { item: SearchResult }) {
  const tone = SOURCE_TONES[item.source_type] ?? 'neutral';
  const meta = parseMeta(item.metadata_json);
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{SOURCE_LABELS[item.source_type] ?? item.source_type}</Badge>
        <span className="text-xs text-slate-500">#{item.source_id}</span>
        {meta.student_name ? <span className="text-xs text-slate-500">{meta.student_name}</span> : null}
        <span className="ml-auto">
          <SimilarityBar value={item.similarity} />
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.chunk_text}</p>
    </div>
  );
}
export default function KnowledgeBase() {
  const { toast, success, error, info } = useToast();  const [subjectGroup, setSubjectGroup] = useState('数学');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searchedAt, setSearchedAt] = useState<string | null>(null);

  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [indexing, setIndexing] = useState<'incremental' | 'rebuild' | null>(null);
  const [lastJob, setLastJob] = useState<IndexJobStatus | null>(null);

  const [digest, setDigest] = useState<Digest | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestRange, setDigestRange] = useState({ start: '', end: '' });

  const [similarStudents, setSimilarStudents] = useState<SimilarStudent[] | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarInput, setSimilarInput] = useState({
    studentId: '',
    learningStyle: 'visual',
    weakPoints: '',
    strongPoints: '',
  });
  const [groups, setGroups] = useState<KnowledgeGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupSubject, setGroupSubject] = useState('数学');
  const [joinCode, setJoinCode] = useState('');
  const [groupBusy, setGroupBusy] = useState<'create' | 'join' | null>(null);
  const [oneTimeJoinCode, setOneTimeJoinCode] = useState<OneTimeJoinCode | null>(null);
  const [groupMembers, setGroupMembers] = useState<{ groupId: number; rows: KnowledgeGroupMember[] } | null>(null);
  const [groupManagementError, setGroupManagementError] = useState<{ groupId: number; message: string } | null>(null);
  const [groupManagementBusy, setGroupManagementBusy] = useState<{
    groupId: number;
    action: 'members' | 'rotate' | 'revoke' | 'remove';
    memberId?: number;
  } | null>(null);
  const groupManagementRequest = useRef(0);
  const selectedGroup = groups.find((group) => String(group.id) === selectedGroupId) ?? null;
  const selectedGroupManagementBusy = groupManagementBusy?.groupId === selectedGroup?.id ? groupManagementBusy : null;
  const effectiveSubjectGroup = selectedGroup?.subject_group ?? subjectGroup;
  const scopeSuffix = selectedGroup ? '&groupId=' + encodeURIComponent(String(selectedGroup.id)) : '';
  useEffect(() => {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 6 * 24 * 3600 * 1000);
    setDigestRange({
      start: startDate.toISOString().slice(0, 10),
      end: endDate.toISOString().slice(0, 10),
    });
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      const data = await api.get('/knowledge/groups');
      const rows = asRecord(data)?.groups;
      setGroups(Array.isArray(rows)
        ? rows.map(normalizeGroup).filter((group): group is KnowledgeGroup => group !== null)
        : []);
    } catch (err) {
      setGroups([]);
      error(err instanceof Error ? err.message : '加载教研组失败');
    }
  }, [error]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    groupManagementRequest.current += 1;
    setGroupMembers(null);
    setGroupManagementError(null);
    setGroupManagementBusy(null);
  }, [selectedGroupId]);

  const loadStats = useCallback(async () => {
    if (!effectiveSubjectGroup) return;
    setStatsLoading(true);
    try {
      const data = await api.get(
        '/knowledge/stats?subjectGroup=' + encodeURIComponent(effectiveSubjectGroup) + scopeSuffix
      );
      setStats(normalizeStats(data, effectiveSubjectGroup));
    } catch (err) {
      error(err instanceof Error ? err.message : '加载知识库统计失败');
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, [effectiveSubjectGroup, scopeSuffix, error]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    setResults(null);
    setSearchedAt(null);
    setDigest(null);
    setSimilarStudents(null);
    setLastJob(null);
  }, [effectiveSubjectGroup, selectedGroupId]);
  const handleCreateGroup = async () => {
    const name = groupName.trim();
    if (!name) {
      error('请填写教研组名称');
      return;
    }
    setGroupBusy('create');
    try {
      const data = await api.post('/knowledge/groups', { name, subjectGroup: groupSubject });
      const created = normalizeGroup(asRecord(data)?.group);
      if (!created) throw new Error('创建教研组的响应格式异常');
      setGroups((current) => [created, ...current.filter((group) => group.id !== created.id)]);
      setSelectedGroupId(String(created.id));
      setGroupName('');
      const rawJoinCode = textValue(asRecord(data)?.joinCode);
      setOneTimeJoinCode(rawJoinCode ? { groupId: created.id, code: rawJoinCode, kind: 'created' } : null);
      if (rawJoinCode) success('教研组已创建；邀请码仅在本次响应中显示');
      else error('教研组已创建，但邀请码响应异常，无法邀请新成员');
    } catch (err) {
      error(err instanceof Error ? err.message : '创建教研组失败');
    } finally {
      setGroupBusy(null);
    }
  };

  const handleJoinGroup = async () => {
    const code = joinCode.trim();
    if (!code) {
      error('请填写一次性邀请码');
      return;
    }
    setGroupBusy('join');
    try {
      const data = await api.post('/knowledge/groups/join', { joinCode: code });
      const joined = normalizeGroup(asRecord(data)?.group);
      if (!joined) throw new Error('加入教研组的响应格式异常');
      setGroups((current) => [joined, ...current.filter((group) => group.id !== joined.id)]);
      setSelectedGroupId(String(joined.id));
      setJoinCode('');
      setOneTimeJoinCode(null);
      if (asRecord(data)?.alreadyMember === true) info('你已经是该组成员，已切换到共享范围');
      else success('已加入教研组；邀请码已失效');
    } catch (err) {
      error(err instanceof Error ? err.message : '加入教研组失败');
    } finally {
      setGroupBusy(null);
    }
  };

  const updateGroupFromResponse = (value: unknown, groupId: number): boolean => {
    const updated = normalizeGroup(value);
    if (!updated || updated.id !== groupId) return false;
    setGroups((current) => current.map((group) => group.id === groupId ? updated : group));
    return true;
  };

  const loadGroupMembers = async () => {
    if (!selectedGroup || selectedGroup.role !== 'owner' || selectedGroupManagementBusy) return;
    const groupId = selectedGroup.id;
    const requestId = ++groupManagementRequest.current;
    setGroupManagementBusy({ groupId, action: 'members' });
    setGroupManagementError(null);
    try {
      const data = await api.get('/knowledge/groups/' + groupId + '/members');
      const body = asRecord(data);
      const rawMembers = body?.members;
      if (numberValue(body?.groupId, NaN) !== groupId || !Array.isArray(rawMembers)) {
        throw new Error('成员列表响应格式异常，未更新成员数据');
      }
      const normalized = rawMembers.map(normalizeGroupMember);
      if (normalized.some((member) => member === null)) {
        throw new Error('成员列表包含无效记录，未更新成员数据');
      }
      if (groupManagementRequest.current !== requestId) return;
      setGroupMembers({
        groupId,
        rows: normalized.filter((member): member is KnowledgeGroupMember => member !== null),
      });
    } catch (err) {
      if (groupManagementRequest.current === requestId) {
        setGroupManagementError({ groupId, message: err instanceof Error ? err.message : '加载教研组成员失败' });
      }
    } finally {
      if (groupManagementRequest.current === requestId) setGroupManagementBusy(null);
    }
  };

  const handleRotateJoinCode = async () => {
    if (!selectedGroup || selectedGroup.role !== 'owner' || selectedGroupManagementBusy) return;
    const groupId = selectedGroup.id;
    if (!window.confirm('轮换后，旧邀请码会立即失效；新邀请码只显示一次。确认轮换「' + selectedGroup.name + '」的邀请码吗？')) return;
    const requestId = ++groupManagementRequest.current;
    setGroupManagementBusy({ groupId, action: 'rotate' });
    setGroupManagementError(null);
    // 请求结果不明时也不能继续展示可能已失效的旧明文。
    setOneTimeJoinCode(null);
    try {
      const data = await api.post('/knowledge/groups/' + groupId + '/join-code/rotate', {});
      const nextCode = textValue(asRecord(data)?.joinCode).trim();
      if (!nextCode) throw new Error('轮换响应缺少新邀请码，无法确认新码；请重试轮换');
      if (groupManagementRequest.current !== requestId) return;
      updateGroupFromResponse(asRecord(data)?.group, groupId);
      setOneTimeJoinCode({ groupId, code: nextCode, kind: 'rotated' });
      success('邀请码已轮换；旧邀请码已失效，新邀请码仅本次显示');
    } catch (err) {
      if (groupManagementRequest.current === requestId) {
        setGroupManagementError({ groupId, message: err instanceof Error ? err.message : '轮换邀请码失败' });
      }
    } finally {
      if (groupManagementRequest.current === requestId) setGroupManagementBusy(null);
    }
  };

  const handleRevokeJoinCode = async () => {
    if (!selectedGroup || selectedGroup.role !== 'owner' || selectedGroupManagementBusy) return;
    const groupId = selectedGroup.id;
    if (!window.confirm('撤销后，现有邀请码都会失效，需重新轮换才能邀请新成员。确认撤销「' + selectedGroup.name + '」的邀请码吗？')) return;
    const requestId = ++groupManagementRequest.current;
    setGroupManagementBusy({ groupId, action: 'revoke' });
    setGroupManagementError(null);
    setOneTimeJoinCode(null);
    try {
      const data = await api.delete('/knowledge/groups/' + groupId + '/join-code');
      if (asRecord(data)?.revoked !== true) throw new Error('撤销响应格式异常，未确认撤销成功');
      if (groupManagementRequest.current !== requestId) return;
      updateGroupFromResponse(asRecord(data)?.group, groupId);
      success('邀请码已撤销，旧邀请码均已失效');
    } catch (err) {
      if (groupManagementRequest.current === requestId) {
        setGroupManagementError({ groupId, message: err instanceof Error ? err.message : '撤销邀请码失败' });
      }
    } finally {
      if (groupManagementRequest.current === requestId) setGroupManagementBusy(null);
    }
  };

  const handleRemoveGroupMember = async (member: KnowledgeGroupMember) => {
    if (!selectedGroup || selectedGroup.role !== 'owner' || selectedGroupManagementBusy || member.role !== 'member') return;
    const groupId = selectedGroup.id;
    if (!window.confirm('确认将普通成员「' + member.username + '」从「' + selectedGroup.name + '」移除吗？该成员将立即失去此共享范围的访问权限。')) return;
    const requestId = ++groupManagementRequest.current;
    setGroupManagementBusy({ groupId, action: 'remove', memberId: member.user_id });
    setGroupManagementError(null);
    try {
      const data = await api.delete('/knowledge/groups/' + groupId + '/members/' + member.user_id);
      if (numberValue(asRecord(data)?.removedMemberId, NaN) !== member.user_id) {
        throw new Error('移除成员响应格式异常，未确认移除成功');
      }
      if (groupManagementRequest.current !== requestId) return;
      const summaryUpdated = updateGroupFromResponse(asRecord(data)?.group, groupId);
      if (!summaryUpdated) {
        setGroups((current) => current.map((group) => group.id === groupId
          ? { ...group, member_count: Math.max(0, group.member_count - 1) }
          : group));
      }
      setGroupMembers((current) => current?.groupId === groupId
        ? { groupId, rows: current.rows.filter((row) => row.user_id !== member.user_id) }
        : current);
      success('已移除成员「' + member.username + '」');
    } catch (err) {
      if (groupManagementRequest.current === requestId) {
        setGroupManagementError({ groupId, message: err instanceof Error ? err.message : '移除成员失败' });
      }
    } finally {
      if (groupManagementRequest.current === requestId) setGroupManagementBusy(null);
    }
  };

  const handleSearch = async () => {
    const text = query.trim();
    if (!text) {
      error('请先输入要搜索的内容');
      return;
    }
    setSearching(true);
    try {
      const data = await api.get(
        '/knowledge/search?subjectGroup=' +
          encodeURIComponent(effectiveSubjectGroup) +
          '&q=' +
          encodeURIComponent(text) +
          '&limit=10' + scopeSuffix
      );
      setResults(normalizeSearchResults(asRecord(data)?.results));
      setSearchedAt(new Date().toLocaleTimeString());
    } catch (err) {
      error(err instanceof Error ? err.message : '语义搜索失败');
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleIndex = async (mode: 'incremental' | 'rebuild') => {
    if (selectedGroup) {
      error('共享范围为只读检索；请切换到个人知识库后维护自己的索引');
      return;
    }
    setIndexing(mode);
    try {
      const data = await api.post('/knowledge/index/' + mode, { subjectGroup: effectiveSubjectGroup });
      setLastJob(normalizeJob(asRecord(data)?.status));
      success(mode === 'incremental' ? '增量索引完成' : '全量重建完成');
      await loadStats();
    } catch (err) {
      error(err instanceof Error ? err.message : '索引失败');
    } finally {
      setIndexing(null);
    }
  };
  const handleDigest = async () => {
    if (!digestRange.start || !digestRange.end) {
      error('请选择周报时间范围');
      return;
    }
    setDigestLoading(true);
    try {
      const data = await api.get(
        '/knowledge/weekly-digest?subjectGroup=' +
          encodeURIComponent(effectiveSubjectGroup) +
          '&startDate=' +
          encodeURIComponent(digestRange.start) +
          '&endDate=' +
          encodeURIComponent(digestRange.end + ' 23:59:59') + scopeSuffix
      );
      const nextDigest = normalizeDigest(asRecord(data)?.digest);
      if (!nextDigest) throw new Error('周报响应格式异常，未展示不完整结果');
      setDigest(nextDigest);
      toast('周报摘要已生成');
    } catch (err) {
      setDigest(null);
      error(err instanceof Error ? err.message : '生成周报失败');
    } finally {
      setDigestLoading(false);
    }
  };
  const handleSimilar = async () => {
    const studentId = Number(similarInput.studentId);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      error('请填写要对比的学生 id（正整数）');
      return;
    }
    const weakPoints = similarInput.weakPoints.split(/[,\uff0c\n]/).map((s) => s.trim()).filter(Boolean);
    const strongPoints = similarInput.strongPoints.split(/[,\uff0c\n]/).map((s) => s.trim()).filter(Boolean);
    setSimilarLoading(true);
    try {
      const data = await api.post('/knowledge/similar-students', {
        subjectGroup: effectiveSubjectGroup,
        studentId,
        studentProfile: {
          weak_points: weakPoints,
          strong_points: strongPoints,
          learning_style: similarInput.learningStyle,
        },
        limit: 5,
        ...(selectedGroup ? { groupId: selectedGroup.id } : {}),
      });
      const nextSimilar = normalizeSimilarStudents(asRecord(data)?.similar);
      setSimilarStudents(nextSimilar);
      if (nextSimilar.length === 0) {
        info('没有找到足够相似的历史学情，可以先到「索引」里建立一次');
      }
    } catch (err) {
      setSimilarStudents([]);
      error(err instanceof Error ? err.message : '相似学生检索失败');
    } finally {
      setSimilarLoading(false);
    }
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <BookOpen className="h-5 w-5 text-brand-600" />
            教研组知识库
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            把本人或已加入教研组的回访、月报和听评课记录向量化，按语义检索教学话术、相似学情与本周重点。
          </p>
        </div>
        <div className="w-48">
          <Select
            label="科组"
            value={effectiveSubjectGroup}
            disabled={selectedGroup !== null}
            onChange={(e) => setSubjectGroup(e.target.value)}
            options={[...new Set([effectiveSubjectGroup, ...DEFAULT_GROUPS])].map((name) => ({ value: name, label: name }))}
          />
        </div>
      </div>
      <Card>
        <CardHeader
          title="个人与教研组共享"
          description="个人库始终仅本人可见；只有显式创建或加入的教研组才能跨成员检索，相同科目不会自动共享。"
          icon={<Users className="h-3.5 w-3.5" />}
        />
        <CardBody>
          <div className="grid gap-3 md:grid-cols-2">
            <Select
              label="知识库范围"
              value={selectedGroupId}
              onChange={(e) => {
                setSelectedGroupId(e.target.value);
                setStats(null);
                setOneTimeJoinCode(null);
              }}
              options={[
                { value: '', label: '个人知识库（仅本人）' },
                ...groups.map((group) => ({
                  value: String(group.id),
                  label: '共享：' + group.name + '（' + group.subject_group + '）',
                })),
              ]}
            />
            <div className={'rounded-xl border px-3 py-2 text-sm ' + (selectedGroup ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-slate-200 bg-slate-50 text-slate-600')}>
              {selectedGroup ? (
                <p><strong>共享范围：{selectedGroup.name}</strong> · {selectedGroup.member_count} 名成员 · 仅该组已加入成员的本科目内容参与检索。</p>
              ) : (
                <p><strong>个人范围</strong> · 仅检索和维护本人内容，其他教师及未加入的群组不可见。</p>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 p-3">
              <h2 className="text-sm font-medium text-slate-800">创建教研组</h2>
              <p className="mt-1 text-xs text-slate-500">创建后自动成为 owner，并获得只能使用一次的邀请码。</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Input
                  label="新教研组名称"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="例如：五年级数学教研组"
                />
                <Select
                  label="新组科目"
                  value={groupSubject}
                  onChange={(e) => setGroupSubject(e.target.value)}
                  options={DEFAULT_GROUPS.map((name) => ({ value: name, label: name }))}
                />
              </div>
              <button
                type="button"
                onClick={() => void handleCreateGroup()}
                disabled={groupBusy !== null}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-3 text-xs font-medium text-white disabled:opacity-60"
              >
                {groupBusy === 'create' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                创建教研组
              </button>
            </section>

            <section className="rounded-xl border border-slate-200 p-3">
              <h2 className="text-sm font-medium text-slate-800">加入已有教研组</h2>
              <p className="mt-1 text-xs text-slate-500">输入组内成员安全转交的一次性邀请码；加入后原邀请码立即失效。</p>
              <Input
                label="一次性邀请码"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                autoComplete="off"
                placeholder="粘贴一次性邀请码"
                className="mt-3"
              />
              <button
                type="button"
                onClick={() => void handleJoinGroup()}
                disabled={groupBusy !== null}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 disabled:opacity-60"
              >
                {groupBusy === 'join' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                加入教研组
              </button>
            </section>
          </div>

          {selectedGroup?.role === 'owner' ? (
            <section className="mt-4 rounded-xl border border-slate-200 p-3" aria-label="教研组管理">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium text-slate-800">教研组管理</h2>
                  <p className="mt-1 text-xs text-slate-500">仅 owner 可查看成员和维护邀请码；移除成员后，该成员立即失去共享访问权限。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void loadGroupMembers()}
                    disabled={selectedGroupManagementBusy !== null}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 disabled:opacity-60"
                  >
                    {selectedGroupManagementBusy?.action === 'members' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                    {selectedGroupManagementBusy?.action === 'members' ? '加载成员中' : groupMembers?.groupId === selectedGroup.id ? '刷新成员' : '查看成员'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRotateJoinCode()}
                    disabled={selectedGroupManagementBusy !== null}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-700 disabled:opacity-60"
                  >
                    {selectedGroupManagementBusy?.action === 'rotate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {selectedGroupManagementBusy?.action === 'rotate' ? '轮换中' : '轮换邀请码'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRevokeJoinCode()}
                    disabled={selectedGroupManagementBusy !== null}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-700 disabled:opacity-60"
                  >
                    {selectedGroupManagementBusy?.action === 'revoke' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {selectedGroupManagementBusy?.action === 'revoke' ? '撤销中' : '撤销邀请码'}
                  </button>
                </div>
              </div>
              {groupManagementError?.groupId === selectedGroup.id ? (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
                  {groupManagementError.message}
                </p>
              ) : null}
              {groupMembers?.groupId === selectedGroup.id ? (
                <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="组成员列表">
                  {groupMembers.rows.map((member) => {
                    const removing = selectedGroupManagementBusy?.action === 'remove' && selectedGroupManagementBusy.memberId === member.user_id;
                    return (
                      <li key={member.user_id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                        <span className="font-medium text-slate-800">{member.username}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{member.role}</span>
                        <span className="text-xs text-slate-400">加入时间：{member.joined_at || '未提供'}</span>
                        {member.role === 'member' ? (
                          <button
                            type="button"
                            onClick={() => void handleRemoveGroupMember(member)}
                            disabled={selectedGroupManagementBusy !== null}
                            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 disabled:opacity-60"
                          >
                            {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                            {removing ? '移除中' : '移除成员 ' + member.username}
                          </button>
                        ) : member.role === 'owner' ? (
                          <span className="ml-auto text-xs text-slate-400">owner 不可移除</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : selectedGroupManagementBusy?.action !== 'members' ? (
                <p className="mt-3 text-xs text-slate-400">点击「查看成员」从服务端加载当前组的实际成员。</p>
              ) : (
                <p className="mt-3 text-xs text-slate-500" role="status">正在加载当前组成员…</p>
              )}
            </section>
          ) : null}

          {oneTimeJoinCode && oneTimeJoinCode.groupId === selectedGroup?.id ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">
                  {oneTimeJoinCode.kind === 'rotated' ? '新一次性邀请码（旧码已失效，仅本次显示）' : '一次性邀请码（仅本次显示，请通过安全渠道发送）'}
                </p>
                <button type="button" onClick={() => setOneTimeJoinCode(null)} className="text-xs underline">关闭邀请码</button>
              </div>
              <code className="mt-2 block break-all rounded bg-white px-2 py-1.5 text-xs">{oneTimeJoinCode.code}</code>
              <p className="mt-2 text-xs">
                {oneTimeJoinCode.kind === 'rotated'
                  ? '旧邀请码已失效；新邀请码只可由一位新成员使用，关闭或刷新后无法再次查看。'
                  : '只可由一位新成员使用；页面不会保存明文，服务端也只保存哈希。'}
              </p>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="语义搜索"
          description="自然语言描述你要找的东西，例如「分数通分学生总漏乘分子时的讲法」"
          icon={<Search className="h-3.5 w-3.5" />}
        />
        <CardBody>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <Input
                label="检索内容"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="例如：如何给基础薄弱的学生讲分数通分"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSearch()}
              disabled={searching}
              className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              搜索
            </button>
          </div>
          {searchedAt ? (
            <p className="mt-2 text-xs text-slate-400">
              检索于 {searchedAt} · 科组 {effectiveSubjectGroup} · {selectedGroup ? '共享组' : '仅本人'}
            </p>
          ) : null}
          {results === null ? (
            <p className="mt-4 text-sm text-slate-400">输入一句话，从{selectedGroup ? '当前共享组成员' : '本人'}的历史记录里找最接近的片段。</p>
          ) : results.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
              没有达到相似度阈值的片段。{selectedGroup ? '可由组内成员在个人范围维护自己的索引。' : '可以先点下方「增量索引」把最新内容入库。'}
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {results.map((item) => (
                <ResultCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={selectedGroup ? '共享知识库统计' : '个人知识库统计'}
          description={selectedGroup ? '共享范围为只读检索；索引维护请切换到个人知识库' : '新增回访/月报后点一次增量索引，本人知识库即可被检索'}
          icon={<Database className="h-3.5 w-3.5" />}
          action={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleIndex('incremental')}
                disabled={indexing !== null || selectedGroup !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {indexing === 'incremental' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                增量索引
              </button>
              <button
                type="button"
                onClick={() => void handleIndex('rebuild')}
                disabled={indexing !== null || selectedGroup !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {indexing === 'rebuild' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                全量重建
              </button>
            </div>
          }
        />
        <CardBody>
          {statsLoading && !stats ? (
            <ListSkeleton rows={2} />
          ) : stats ? (
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">知识片段</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{stats.total_chunks}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">覆盖学生</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{stats.unique_students}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">最近索引</p>
                <p className="mt-1 text-sm text-slate-700">{stats.latest_indexed ?? '尚未索引'}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">来源构成</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {stats.by_source_type.length === 0 ? (
                    <span className="text-sm text-slate-400">—</span>
                  ) : (
                    stats.by_source_type.map((row) => (
                      <Badge key={row.source_type} tone="neutral">
                        {SOURCE_LABELS[row.source_type] ?? row.source_type} {row.count}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">还没有该科组的索引数据。</p>
          )}

          {lastJob ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              处理 {lastJob.processed} 条 · 跳过 {lastJob.skipped} 条 · 失败 {lastJob.failed} 条
              {lastJob.errors.length > 0 ? (
                <span className="ml-2 text-rose-600">{lastJob.errors.slice(0, 3).join('；')}</span>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="教研组周报"
            description="按时间范围汇总组内的重点话题、共性问题与建议"
            icon={<FileText className="h-3.5 w-3.5" />}
            action={
              <button
                type="button"
                onClick={() => void handleDigest()}
                disabled={digestLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {digestLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                生成周报
              </button>
            }
          />
          <CardBody>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">开始日期</span>
                <input
                  type="date"
                  value={digestRange.start}
                  onChange={(e) => setDigestRange({ ...digestRange, start: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">结束日期</span>
                <input
                  type="date"
                  value={digestRange.end}
                  onChange={(e) => setDigestRange({ ...digestRange, end: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
                />
              </label>
            </div>

            {digest ? (
              <div className="mt-4 space-y-4 rounded-xl border border-slate-200 p-4">
                <p className="text-xs text-slate-500">
                  {digest.subject_group} · {digest.period.start} 至 {digest.period.end}
                </p>
                <BulletList title="本周核心话题" items={digest.key_topics} />
                <BulletList title="老师心得" items={digest.teacher_insights} />
                <BulletList title="共性问题" items={digest.common_challenges} />
                <BulletList title="改进建议" items={digest.recommendations} />
              </div>
            ) : (
              <p className="mt-4 flex items-center gap-2 text-sm text-slate-400">
                <Lightbulb className="h-4 w-4" />
                选好日期后点「生成周报」，会用组内这段时间的片段汇总一份摘要。
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="相似学情检索"
            description="按学生画像找历史上处理过类似情况的学生（需先建立索引）"
            icon={<Users className="h-3.5 w-3.5" />}
          />
          <CardBody>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="学生 ID"
                value={similarInput.studentId}
                onChange={(e) => setSimilarInput({ ...similarInput, studentId: e.target.value })}
                placeholder="例如 12"
              />
              <Select
                label="学习风格"
                value={similarInput.learningStyle}
                onChange={(e) => setSimilarInput({ ...similarInput, learningStyle: e.target.value })}
                options={[
                  { value: 'visual', label: '视觉型' },
                  { value: 'auditory', label: '听觉型' },
                  { value: 'kinesthetic', label: '动觉型' },
                  { value: 'reading_writing', label: '读写型' },
                ]}
              />
            </div>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">薄弱点（逗号分隔）</span>
                <input
                  type="text"
                  value={similarInput.weakPoints}
                  onChange={(e) => setSimilarInput({ ...similarInput, weakPoints: e.target.value })}
                  placeholder="分数运算, 应用题建模"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">优势点（逗号分隔）</span>
                <input
                  type="text"
                  value={similarInput.strongPoints}
                  onChange={(e) => setSimilarInput({ ...similarInput, strongPoints: e.target.value })}
                  placeholder="几何直观, 逻辑推理"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
                />
              </label>
              <button
                type="button"
                onClick={() => void handleSimilar()}
                disabled={similarLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {similarLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                查找相似学生
              </button>
            </div>

            {similarStudents === null ? (
              <p className="mt-4 text-sm text-slate-400">填好画像后检索，能看到历史上处理过类似情况的学生与当时的片段。</p>
            ) : similarStudents.length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">没有找到相似的学情记录。</p>
            ) : (
              <div className="mt-4 space-y-3">
                {similarStudents.map((student) => (
                  <div key={student.student_id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">{student.student_name}</span>
                      <Badge tone="neutral">{student.grade}</Badge>
                      <span className="ml-auto">
                        <SimilarityBar value={student.similarity} />
                      </span>
                    </div>
                    {student.matching_chunks.slice(0, 2).map((chunk) => (
                      <p
                        key={chunk.id}
                        className="mt-2 line-clamp-3 rounded-lg bg-slate-50 p-2 text-xs leading-5 text-slate-600"
                      >
                        {chunk.chunk_text}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
