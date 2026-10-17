import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/ui/Toast';
import { loadDraft } from '../lib/draft';

export interface GroupPreset {
  id: number;
  name: string;
  studentIds: number[];
  memberCount: number;
}

export interface UseGroupManagementResult {
  groups: GroupPreset[];
  selectedIds: number[];
  setSelectedIds: React.Dispatch<React.SetStateAction<number[]>>;
  showGroupSave: boolean;
  setShowGroupSave: (v: boolean) => void;
  newGroupName: string;
  setNewGroupName: (v: string) => void;
  applyGroup: (g: { studentIds: number[] }) => void;
  saveGroup: () => Promise<void>;
  deleteGroup: (id: number, name: string) => Promise<void>;
  toggleStudent: (id: number) => void;
  clearSelected: () => void;
}

/**
 * 小组课的分组预设 + 学生多选。
 *
 * 场景：同一个班每周都是那几个人，偶尔有人请假。分组只是「可一键勾选的成员」，
 * 不保证每次都全员到齐 —— 老师点一下全选，再手动取消请假的。
 *
 * 抽出来后主组件少 4 个 state、4 个方法、1 个 useEffect（分组拉取）。
 */
export function useGroupManagement(): UseGroupManagementResult {
  const toast = useToast();
  const [groups, setGroups] = useState<GroupPreset[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>(() => loadDraft()?.selectedIds || []);
  const [showGroupSave, setShowGroupSave] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  // 分组预设（小组课用）
  useEffect(() => {
    api
      .get('/groups')
      .then((r) => setGroups(r.groups || []))
      .catch(() => {
        /* 分组只是便利功能，失败静默 */
      });
  }, []);

  /** 应用分组：默认全选，老师再手动取消请假的 */
  const applyGroup = (g: { studentIds: number[] }) => {
    setSelectedIds(g.studentIds);
  };

  const saveGroup = async () => {
    const name = newGroupName.trim();
    if (!name) {
      toast.error('请填写分组名称');
      return;
    }
    if (selectedIds.length === 0) {
      toast.error('请先选择学生，再存为分组');
      return;
    }

    try {
      const r = await api.post('/groups', { name, studentIds: selectedIds });
      setGroups((prev) => [r.group, ...prev]);
      setNewGroupName('');
      setShowGroupSave(false);
      toast.success('已保存分组「' + name + '」');
    } catch (err: any) {
      toast.error('保存分组失败：' + err.message);
    }
  };

  const deleteGroup = async (id: number, name: string) => {
    try {
      await api.delete('/groups/' + id);
      setGroups((prev) => prev.filter((x) => x.id !== id));
      toast.success('已删除分组「' + name + '」');
    } catch (err: any) {
      toast.error('删除分组失败：' + err.message);
    }
  };

  const toggleStudent = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const clearSelected = () => setSelectedIds([]);

  return {
    groups,
    selectedIds,
    setSelectedIds,
    showGroupSave,
    setShowGroupSave,
    newGroupName,
    setNewGroupName,
    applyGroup,
    saveGroup,
    deleteGroup,
    toggleStudent,
    clearSelected,
  };
}
