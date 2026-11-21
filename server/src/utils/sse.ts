import type { Response, Request } from 'express';
import { log } from './logger.js';
import { db } from '../config/database.js';

export const STREAM_RETENTION_MS = 15 * 60 * 1000;

export type StreamTerminalEvent = {
  event: 'done' | 'error';
  data: unknown;
};

type StreamSessionStatus = 'running' | 'interrupted' | 'done' | 'error';

type StreamSessionRow = {
  stream_id: string;
  user_id: number;
  status: StreamSessionStatus;
  terminal_event: 'done' | 'error' | null;
  terminal_data: string | null;
  expires_at: number;
};

export type StreamChunk = { seq: number; delta: string; phase: string };

export type ResumeStreamResult =
  | { kind: 'not_found' | 'expired' | 'running' }
  | {
      kind: 'ready';
      status: Exclude<StreamSessionStatus, 'running'>;
      chunks: StreamChunk[];
      terminal: StreamTerminalEvent | null;
    };

/**
 * 打开一条 SSE 响应并返回写接口。回访和月度总结的流式路由共用这一份。
 *
 * 客户端提前断开检测不能用 req.on('close')：请求体读完后它就可能触发。
 * res 的 close 配合 writableEnded 才能区分正常结束和中途掉线。
 */
export function openSse(req: Request, res: Response, streamId: string) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-Stream-ID', streamId);
  res.flushHeaders?.();

  let clientGone = false;
  const heartbeatTimer = setInterval(() => {
    if (clientGone || res.writableEnded) {
      clearInterval(heartbeatTimer);
      return;
    }
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clientGone = true;
      clearInterval(heartbeatTimer);
    }
  }, 15000);

  res.on('close', () => {
    if (!res.writableEnded) clientGone = true;
    clearInterval(heartbeatTimer);
  });

  const send = (event: string, data: unknown, options?: { id?: string }) => {
    if (clientGone || res.writableEnded) return;
    try {
      let payload = 'event: ' + event + '\n';
      if (options?.id) payload += 'id: ' + options.id + '\n';
      payload += 'data: ' + JSON.stringify(data) + '\n\n';
      res.write(payload);
    } catch {
      clientGone = true;
    }
  };

  return {
    send,
    isGone: () => clientGone,
    end: () => {
      clearInterval(heartbeatTimer);
      if (!res.writableEnded) res.end();
    },
  };
}

/** 创建有归属和保留期的流会话；最终事件与分片分开保存。 */
export function createStreamSession(streamId: string, userId: number): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO ai_stream_sessions (stream_id, user_id, status, expires_at)
    VALUES (?, ?, 'running', ?)
  `).run(streamId, userId, now + STREAM_RETENTION_MS);
}

/** 保存终态，供断线后的只读重放使用。 */
export function finishStreamSession(
  streamId: string,
  status: Exclude<StreamSessionStatus, 'running'>,
  terminal: StreamTerminalEvent,
): void {
  db.prepare(`
    UPDATE ai_stream_sessions
    SET status = ?, terminal_event = ?, terminal_data = ?,
        updated_at = strftime('%s', 'now'), expires_at = ?
    WHERE stream_id = ?
  `).run(status, terminal.event, JSON.stringify(terminal.data), Date.now() + STREAM_RETENTION_MS, streamId);
}

/**
 * 按用户读取续传内容。查询本身带 user_id，避免把 streamId 当作访问凭证。
 * 过期时同时删除会话和分片；不存在与跨用户统一返回 not_found。
 */
export function loadStreamForResume(
  streamId: string,
  userId: number,
  lastEventId: number,
): ResumeStreamResult {
  const session = db.prepare(`
    SELECT stream_id, user_id, status, terminal_event, terminal_data, expires_at
    FROM ai_stream_sessions
    WHERE stream_id = ? AND user_id = ?
  `).get(streamId, userId) as StreamSessionRow | undefined;

  if (!session) return { kind: 'not_found' };
  if (session.expires_at <= Date.now()) {
    cleanupStream(streamId);
    return { kind: 'expired' };
  }
  if (session.status === 'running') return { kind: 'running' };

  const chunks = db.prepare(`
    SELECT seq, delta, phase FROM ai_stream_chunks
    WHERE stream_id = ? AND seq > ?
    ORDER BY seq ASC
  `).all(streamId, lastEventId) as StreamChunk[];

  let terminal: StreamTerminalEvent | null = null;
  if (session.terminal_event) {
    terminal = {
      event: session.terminal_event,
      data: session.terminal_data === null ? null : JSON.parse(session.terminal_data),
    };
  }
  return { kind: 'ready', status: session.status, chunks, terminal };
}

/** 先持久化再尝试写 socket，确保断线瞬间已交付的上游分片仍可补发。 */
export function persistChunk(streamId: string, seq: number, delta: string, phase: string): void {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO ai_stream_chunks (stream_id, seq, delta, phase)
      VALUES (?, ?, ?, ?)
    `).run(streamId, seq, delta, phase);
  } catch (error: any) {
    log.error({ streamId, seq, error: error.message }, 'SSE 续传：持久化 chunk 失败');
  }
}

/** 删除一条流的所有可续传数据。 */
export function cleanupStream(streamId: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM ai_stream_chunks WHERE stream_id = ?').run(streamId);
    db.prepare('DELETE FROM ai_stream_sessions WHERE stream_id = ?').run(streamId);
  })();
}

/** 兼容仅需清理分片的调用方。 */
export function cleanupChunks(streamId: string): void {
  try {
    db.prepare('DELETE FROM ai_stream_chunks WHERE stream_id = ?').run(streamId);
  } catch (error: any) {
    log.error({ streamId, error: error.message }, 'SSE 续传：清理 chunk 失败');
  }
}
