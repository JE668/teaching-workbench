import { Router, Response } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import { log } from '../utils/logger.js';
import { openSse } from '../utils/sse.js';

const router = Router();

interface DraftPayload {
  form: any;
  report: string;
  reportAt: string | null;
}

/** 在线客户端管理：key = userId * 1000000 + observationId */
const onlineClients = new Map<number, Set<string>>();
const broadcastCallbacks = new Map<number, Array<(exclude: string, msg: any) => void>>();

function getClientKey(userId: number, observationId: number): number {
  return userId * 1_000_000 + observationId;
}

/** 获取当前在线的其他客户端（不含自己） */
function getOtherClients(userId: number, observationId: number, myClientId: string): string[] {
  const key = getClientKey(userId, observationId);
  const clients = onlineClients.get(key);
  if (!clients) return [];
  return Array.from(clients).filter((id) => id !== myClientId);
}

/** 更新在线状态并广播 presence */
function updatePresence(userId: number, observationId: number, clientId: string, isOnline: boolean): void {
  const key = getClientKey(userId, observationId);
  let clients = onlineClients.get(key);
  if (!clients) {
    clients = new Set();
    onlineClients.set(key, clients);
  }

  if (isOnline) {
    clients.add(clientId);
  } else {
    clients.delete(clientId);
    if (clients.size === 0) {
      onlineClients.delete(key);
    }
  }

  // 广播给其他在线客户端
  const msg = { event: 'presence', data: { onlineClients: Array.from(clients) } };
  broadcastCallbacks.get(key)?.forEach((cb) => cb(clientId, msg));
}

/** 广播消息给指定 observation 的所有在线客户端（排除发起方） */
function broadcast(userId: number, observationId: number, excludeClientId: string, message: any): void {
  const key = getClientKey(userId, observationId);
  broadcastCallbacks.get(key)?.forEach((cb) => cb(excludeClientId, message));
}

/**
 * GET /observations/:id/draft
 * 获取听评课草稿
 */
router.get('/:id/draft', (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const observationId = parseInt(req.params.id, 10);
  if (!Number.isFinite(observationId)) {
    return res.status(400).json({ error: '无效的记录 ID' });
  }

  const row = db.prepare('SELECT payload FROM observation_drafts WHERE user_id = ? AND observation_id = ?').get(userId, observationId) as { payload: string } | undefined;
  if (row) {
    return res.json({ draft: JSON.parse(row.payload) });
  }
  res.json({ draft: null });
});

/**
 * PUT /observations/:id/draft
 * 保存听评课草稿，广播给其他在线客户端
 */
router.put('/:id/draft', (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const observationId = parseInt(req.params.id, 10);
  if (!Number.isFinite(observationId)) {
    return res.status(400).json({ error: '无效的记录 ID' });
  }

  const { clientId, payload } = req.body as { clientId: string; payload: DraftPayload };
  if (!clientId || !payload) {
    return res.status(400).json({ error: '缺少 clientId 或 payload' });
  }

  // 校验该 observation 属于当前用户
  const obs = db.prepare('SELECT id FROM observations WHERE id = ? AND user_id = ?').get(observationId, userId);
  if (!obs) {
    return res.status(404).json({ error: '记录不存在' });
  }

  const payloadStr = JSON.stringify(payload);
  db.prepare(`
    INSERT INTO observation_drafts (user_id, observation_id, payload, updated_at)
    VALUES (?, ?, ?, datetime('now', '+8 hours'))
    ON CONFLICT(user_id, observation_id)
    DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).run(userId, observationId, payloadStr);

  // 广播给其他在线客户端
  const msg = {
    event: 'draft',
    data: {
      payload,
      clientId,
      othersOnline: getOtherClients(userId, observationId, clientId),
    },
  };
  broadcast(userId, observationId, clientId, msg);

  res.json({ ok: true });
});

/**
 * DELETE /observations/:id/draft
 * 清空听评课草稿
 */
router.delete('/:id/draft', (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const observationId = parseInt(req.params.id, 10);
  if (!Number.isFinite(observationId)) {
    return res.status(400).json({ error: '无效的记录 ID' });
  }

  const { clientId } = req.body as { clientId: string };
  if (!clientId) {
    return res.status(400).json({ error: '缺少 clientId' });
  }

  db.prepare('DELETE FROM observation_drafts WHERE user_id = ? AND observation_id = ?').run(userId, observationId);

  const msg = {
    event: 'cleared',
    data: {
      clientId,
      othersOnline: getOtherClients(userId, observationId, clientId),
    },
  };
  broadcast(userId, observationId, clientId, msg);

  res.json({ ok: true });
});

/**
 * GET /observations/:id/draft/stream
 * SSE 订阅：实时接收其他设备的草稿更新
 */
router.get('/:id/draft/stream', (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const observationId = parseInt(req.params.id, 10);
  if (!Number.isFinite(observationId)) {
    return res.status(400).json({ error: '无效的记录 ID' });
  }

  const clientId = req.query.clientId as string;
  if (!clientId) {
    return res.status(400).json({ error: '缺少 clientId' });
  }

  openSse(res);

  const key = getClientKey(userId, observationId);

  // 注册客户端
  updatePresence(userId, observationId, clientId, true);

  // 注册广播回调
  let callbacks = broadcastCallbacks.get(key);
  if (!callbacks) {
    callbacks = [];
    broadcastCallbacks.set(key, callbacks);
  }

  const handler = (exclude: string, msg: any) => {
    if (exclude !== clientId) {
      const body = 'event: ' + msg.event + '\ndata: ' + JSON.stringify(msg.data) + '\n\n';
      if (!res.writableEnded) {
        res.write(body);
      }
    }
  };
  callbacks.push(handler);

  // 发送初始状态
  const row = db.prepare('SELECT payload FROM observation_drafts WHERE user_id = ? AND observation_id = ?').get(userId, observationId) as { payload: string } | undefined;
  const draft = row ? JSON.parse(row.payload) : null;
  const initialData = {
    clientId,
    draft,
    onlineClients: getOtherClients(userId, observationId, clientId),
  };
  const initialMsg = 'event: ready\ndata: ' + JSON.stringify(initialData) + '\n\n';
  if (!res.writableEnded) {
    res.write(initialMsg);
  }

  // 清理
  req.socket.on('close', () => {
    updatePresence(userId, observationId, clientId, false);
    if (callbacks) {
      const idx = callbacks.indexOf(handler);
      if (idx !== -1) callbacks.splice(idx, 1);
      if (callbacks.length === 0) {
        broadcastCallbacks.delete(key);
      }
    }
  });

  log.debug({ userId, observationId, clientId }, '听评课草稿 SSE 连接建立');
});

export default router;