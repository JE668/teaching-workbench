import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';

/**
 * 跨设备草稿实时同步。
 *
 * 场景：电脑上写文案，手机上拍作业传图，两边无需刷新即可看到对方的变化。
 *
 * 冲突处理（同一用户两个设备，冲突概率低但必须不能打架）：
 *   1. 服务端广播**不回发给发起方**，避免用自己的状态覆盖自己的光标
 *   2. 远端更新到达时，**跳过当前获得焦点的字段**（正在输入的内容不能被冲掉）
 *   3. 本地刚编辑过的字段有 3 秒保护期，避免两边快速交替编辑时来回覆盖
 */

export interface DraftPayload {
  form: any;
  images: string[];
  selectedIds: number[];
  content: string;
  draft: string;
}

interface Options {
  /** 当前本地状态 */
  state: DraftPayload;
  /** 收到远端更新时回调（skipFields 内的键不要应用） */
  applyRemote: (remote: DraftPayload, skipFields: string[]) => void;
  /** 远端清空草稿（对方已归档） */
  onRemoteCleared?: () => void;
  /** 暂停同步（例如正在归档） */
  paused?: boolean;
}

const LOCAL_GRACE_MS = 3000;
const PUSH_DEBOUNCE_MS = 500;
const RECONNECT_MS = 2500;

/**
 * 键顺序无关的序列化。
 * 用于判断"本地状态是否真的变了"——直接 JSON.stringify 会因键顺序不同而误判。
 */
function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k]))
      .join(',') +
    '}'
  );
}

/** 读取某个 DOM 元素上标记的同步字段名 */
function fieldOf(el: Element | null): string | null {
  if (!el) return null;
  return el.getAttribute?.('data-sync-field') || null;
}

export function useDraftSync({ state, applyRemote, onRemoteCleared, paused }: Options) {
  // 每次挂载生成一个设备标识，用于区分"是我发的"还是"别的设备发的"
  const clientId = useMemo(() => Math.random().toString(36).slice(2, 10), []);

  const [connected, setConnected] = useState(false);
  /** 其它在线设备数量（不含自己） */
  const [peerCount, setPeerCount] = useState(0);

  const lastLocalEdit = useRef<{ field: string; at: number }>({ field: '', at: 0 });
  const stateRef = useRef(state);
  stateRef.current = state;

  /** 最近一次"已同步"的状态快照（本地推送后或应用远端后更新） */
  const lastSynced = useRef<string>('');
  /**
   * 刚应用过远端更新时，记下【远端原始值】作为新的同步基准。
   * 注意不能记"合并后的本地状态"——那会把"因焦点保护而跳过的字段"
   * 也当成已同步，导致本地正在输入的内容永远推不出去。
   */
  const rebaselineTo = useRef<string | null>(null);

  /** 供输入框调用：标记"我刚改了这个字段" */
  const markLocalEdit = useCallback((field: string) => {
    lastLocalEdit.current = { field, at: Date.now() };
  }, []);

  /** 计算本次远端更新需要跳过的字段 */
  const computeSkipFields = useCallback((): string[] => {
    const skip: string[] = [];

    // ① 正在输入的字段
    const focused = fieldOf(document.activeElement);
    if (focused) skip.push(focused);

    // ② 3 秒内本地刚改过的字段
    if (Date.now() - lastLocalEdit.current.at < LOCAL_GRACE_MS && lastLocalEdit.current.field) {
      skip.push(lastLocalEdit.current.field);
    }

    return [...new Set(skip)];
  }, []);

  // ---------- 推送本地改动 ----------
  useEffect(() => {
    if (paused) return;

    // 刚应用过远端更新：以远端原始值为基准，然后继续往下判断。
    // - 没有字段被跳过 → 合并结果 == 远端 → 不推送（避免回声/乒乓）
    // - 有字段被跳过（对方改了、我正在输入）→ 有分歧 → 推回去（正在打字的人赢）
    if (rebaselineTo.current !== null) {
      lastSynced.current = rebaselineTo.current;
      rebaselineTo.current = null;
    }

    const json = stableStringify(state);

    // 与已同步状态一致 → 这次变化源自远端，不该回声推送。
    // 这是避免两台设备互相覆盖的关键。
    if (json === lastSynced.current) return;

    const timer = setTimeout(() => {
      lastSynced.current = json;
      api
        .put('/draft', { clientId, payload: stateRef.current })
        .then(() => setConnected(true))
        .catch(() => {
          /* 网络中断由订阅侧的重连逻辑兜底 */
        });
    }, PUSH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [state, paused, clientId]);

  // 回调放进 ref：若把它们放进 effect 依赖，任何不稳定引用
  // （例如 toast 上下文每次渲染都重建）都会导致 SSE 反复断线重连，
  // 而每次重连都会用服务端草稿覆盖本地尚未上报的改动。
  const handlersRef = useRef({ applyRemote, onRemoteCleared, computeSkipFields });
  handlersRef.current = { applyRemote, onRemoteCleared, computeSkipFields };

  // ---------- 订阅远端改动 ----------
  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      try {
        await api.streamGet(
          '/draft/stream?clientId=' + clientId,
          {
            onOpen: () => setConnected(true),
            onEvent: (event, data) => {
              const { applyRemote, onRemoteCleared, computeSkipFields } = handlersRef.current;

              if (event === 'presence') {
                // 设备上下线时服务端主动推送，无需等心跳
                const peers: string[] = (data?.onlineClients || []).filter(
                  (id: string) => id !== clientId
                );
                setPeerCount(peers.length);
              } else if (event === 'ready' || event === 'ping') {
                setConnected(true);
                const peers: string[] = (data?.onlineClients || []).filter(
                  (id: string) => id !== clientId
                );
                setPeerCount(peers.length);

                // 首次连接时用服务端状态对齐。
                // 但若本地还有尚未上报的改动（例如刚上传的图），
                // 绝不能被服务端的旧状态覆盖 —— 否则重连就等于丢数据。
                if (event === 'ready' && data?.draft) {
                  const hasPendingLocalChanges =
                    lastSynced.current !== '' &&
                    stableStringify(stateRef.current) !== lastSynced.current;

                  if (!hasPendingLocalChanges) {
                    rebaselineTo.current = stableStringify(data.draft);
                    applyRemote(data.draft, computeSkipFields());
                  }
                }
              } else if (event === 'draft') {
                rebaselineTo.current = stableStringify(data.payload);
                applyRemote(data.payload, computeSkipFields());
              } else if (event === 'cleared') {
                onRemoteCleared?.();
              }
            },
          },
          controller.signal
        );
      } catch {
        /* 下面统一重连 */
      }

      setConnected(false);

      // 断线自动重连（nginx 重启、手机切回前台等都会断）
      if (!controller.signal.aborted) {
        retryTimer = setTimeout(connect, RECONNECT_MS);
      }
    };

    connect();

    return () => {
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [clientId]);

  /** 主动清空服务端草稿（归档成功后） */
  const clearRemote = useCallback(async () => {
    try {
      await api.request('/draft', { method: 'DELETE', body: JSON.stringify({ clientId }) });
    } catch {
      /* 忽略：本地已清，服务端残留会被下一次覆盖 */
    }
  }, [clientId]);

  return { connected, peerCount, markLocalEdit, clearRemote, clientId };
}
