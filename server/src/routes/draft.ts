import { Router } from 'express';
import { db } from '../config/database.js';

const router = Router();

/**
 * 跨设备草稿同步。
 *
 * 场景：电脑上写文案，手机上拍作业传图 —— 两边不用刷新就同步。
 *
 * 实现要点：
 * - 服务端保存"进行中的草稿"，是跨设备的唯一事实来源
 * - 客户端改动走 PUT（带 clientId），服务端广播给该用户的其它连接
 * - **广播不回声给发起方**，避免自己覆盖自己的光标位置
 * - 用 SSE 而非 WebSocket：nginx 已为 AI 流式配好 proxy_buffering off，
 *   无需改部署配置，且鉴权走 Authorization 头（EventSource 无法带头，故用 fetch 流）
 */

interface Subscriber {
  clientId: string;
  send: (event: string, data: unknown) => void;
}

// userId -> 该用户所有在线连接
const subscribers = new Map<number, Set<Subscriber>>();

function addSubscriber(userId: number, sub: Subscriber) {
  if (!subscribers.has(userId)) subscribers.set(userId, new Set());
  subscribers.get(userId)!.add(sub);
}

function removeSubscriber(userId: number, sub: Subscriber) {
  const set = subscribers.get(userId);
  if (!set) return;
  set.delete(sub);
  if (set.size === 0) subscribers.delete(userId);
}

/** 广播给该用户的其它设备（排除发起方） */
function broadcast(userId: number, fromClientId: string | undefined, event: string, data: unknown) {
  const set = subscribers.get(userId);
  if (!set) return;

  for (const sub of set) {
    if (fromClientId && sub.clientId === fromClientId) continue;
    sub.send(event, data);
  }
}

/** 该用户当前的在线设备 clientId 列表（用于前端显示"另一台设备已连接"） */
function onlineClients(userId: number): string[] {
  return [...(subscribers.get(userId) || [])].map((s) => s.clientId);
}

/**
 * 设备上下线时主动广播在线列表。
 * 否则对方要等下一个心跳（25s）才知道，界面上会长时间显示"未连接其它设备"。
 */
function broadcastPresence(userId: number) {
  const set = subscribers.get(userId);
  if (!set) return;

  const clients = onlineClients(userId);
  for (const sub of set) {
    sub.send('presence', { onlineClients: clients });
  }
}

const MAX_PAYLOAD = 512 * 1024; // 512KB，防止异常膨胀

function readDraft(userId: number): { payload: any; updatedAt: string } | null {
  const row = db.prepare('SELECT payload, updated_at FROM drafts WHERE user_id = ?').get(userId) as any;
  if (!row) return null;
  try {
    return { payload: JSON.parse(row.payload), updatedAt: row.updated_at };
  } catch {
    return null; // 脏数据按"没有草稿"处理
  }
}

/** 读取当前草稿 */
router.get('/', (req: any, res) => {
  try {
    const draft = readDraft(req.userId);
    res.json({
      draft: draft?.payload ?? null,
      updatedAt: draft?.updatedAt ?? null,
      onlineClients: onlineClients(req.userId),
    });
  } catch (error: any) {
    res.status(500).json({ error: '读取草稿失败', message: error.message });
  }
});

/** 保存草稿并广播到其它设备 */
router.put('/', (req: any, res) => {
  try {
    const userId = req.userId;
    const { clientId, payload } = req.body || {};

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'payload 必填' });
    }

    const json = JSON.stringify(payload);
    if (json.length > MAX_PAYLOAD) {
      return res.status(413).json({ error: '草稿内容过大' });
    }

    db.prepare(
      `INSERT INTO drafts (user_id, payload, updated_at) VALUES (?, ?, datetime('now','localtime'))
       ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
    ).run(userId, json);

    // 不回发给发起方：它本地已经是最新的，回发反而会打断正在输入的光标
    broadcast(userId, clientId, 'draft', { payload, from: clientId, at: Date.now() });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: '保存草稿失败', message: error.message });
  }
});

/** 清空草稿（归档成功后调用），并通知其它设备 */
router.delete('/', (req: any, res) => {
  try {
    const userId = req.userId;
    db.prepare('DELETE FROM drafts WHERE user_id = ?').run(userId);

    broadcast(userId, req.body?.clientId, 'cleared', { from: req.body?.clientId });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: '清空草稿失败', message: error.message });
  }
});

/**
 * 实时订阅（SSE）。
 * 事件：ready / draft / cleared / ping
 */
router.get('/stream', (req: any, res) => {
  const userId = req.userId;
  const clientId = String(req.query.clientId || 'unknown');

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // 与 AI 流式同理：禁用 nginx 缓冲，否则事件会被攒着不下发
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let closed = false;
  const send = (event: string, data: unknown) => {
    if (closed || res.writableEnded) return;
    try {
      res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
    } catch {
      closed = true;
    }
  };

  const sub: Subscriber = { clientId, send };
  addSubscriber(userId, sub);

  // 通知其它设备"多了一台"，让它们立刻更新界面
  broadcastPresence(userId);

  // 建立连接后先同步一次当前状态，避免"另一台设备改了但我连上时没收到"
  const draft = readDraft(userId);
  send('ready', {
    clientId,
    onlineClients: onlineClients(userId),
    draft: draft?.payload ?? null,
    updatedAt: draft?.updatedAt ?? null,
  });

  // 心跳：既保活，也让客户端能据此判断链路是否正常
  const timer = setInterval(() => {
    send('ping', { at: Date.now(), onlineClients: onlineClients(userId) });
  }, 25000);

  // 注意：用 res 的 close 而不是 req 的（请求体读完 req 就会触发）
  res.on('close', () => {
    closed = true;
    clearInterval(timer);
    removeSubscriber(userId, sub);

    // 通知其它设备"少了一台"
    broadcastPresence(userId);
  });
});

export default router;
