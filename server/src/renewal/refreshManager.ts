import { EventEmitter } from 'events';
import { renewalDb } from './db.js';
import { log } from '../utils/logger.js';

/**
 * 数据刷新事件类型
 */
export interface RefreshEvent {
  type: 'report_created' | 'report_updated' | 'report_deleted' | 'data_changed';
  reportId: number;
  userId: number;
  timestamp: string;
  payload?: Record<string, unknown>;
}

/**
 * 数据刷新管理器 - 单例模式
 */
class RefreshManager extends EventEmitter {
  private static instance: RefreshManager;
  private subscribers: Map<number, Set<RefreshCallback>> = new Map();
  private lastRefresh: Map<string, number> = new Map();
  private refreshInterval: Map<number, NodeJS.Timeout> = new Map();
  private readonly DEBOUNCE_MS = 2000;
  private readonly MAX_POLL_INTERVAL = 60000; // 1分钟最大轮询间隔

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  static getInstance(): RefreshManager {
    if (!RefreshManager.instance) {
      RefreshManager.instance = new RefreshManager();
    }
    return RefreshManager.instance;
  }

  /**
   * 订阅报表数据变更
   */
  subscribe(reportId: number, callback: RefreshCallback): () => void {
    if (!this.subscribers.has(reportId)) {
      this.subscribers.set(reportId, new Set());
    }
    this.subscribers.get(reportId)!.add(callback);

    // 返回取消订阅函数
    return () => {
      this.unsubscribe(reportId, callback);
    };
  }

  /**
   * 取消订阅
   */
  unsubscribe(reportId: number, callback: RefreshCallback): void {
    const callbacks = this.subscribers.get(reportId);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.subscribers.delete(reportId);
        this.stopPolling(reportId);
      }
    }
  }

  /**
   * 触发数据刷新通知
   */
  notify(event: RefreshEvent): void {
    const key = `${event.reportId}:${event.userId}`;
    const now = Date.now();
    const lastTime = this.lastRefresh.get(key) || 0;

    // 防抖：短时间内重复触发只保留最后一次
    if (now - lastTime < this.DEBOUNCE_MS) {
      // 延迟触发
      setTimeout(() => this.notify(event), this.DEBOUNCE_MS);
      return;
    }

    this.lastRefresh.set(key, now);

    const callbacks = this.subscribers.get(event.reportId);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(event);
        } catch (error) {
          log.error({ err: error, reportId: event.reportId }, '刷新回调执行失败');
        }
      }
    }

    // 也触发全局事件
    this.emit('refresh', event);
  }

  /**
   * 开始轮询检查数据变更（用于没有 WebSocket 时的降级方案）
   */
  startPolling(reportId: number, userId: number, intervalMs: number = 30000): void {
    if (this.refreshInterval.has(reportId)) {
      return; // 已经在轮询
    }

    let lastHash = '';
    
    const check = async () => {
      try {
        // 计算数据哈希用于检测变更
        const stats = renewalDb.prepare(`
          SELECT 
            COUNT(*) as total,
            MAX(updated_at) as last_update
          FROM renewal_students
          WHERE report_id = ?
        `).get(reportId) as { total: number; last_update: string | null } | undefined;

        if (stats) {
          const currentHash = `${stats.total}:${stats.last_update}`;
          if (lastHash && currentHash !== lastHash) {
            this.notify({
              type: 'data_changed',
              reportId,
              userId,
              timestamp: new Date().toISOString(),
              payload: { total: stats.total, lastUpdate: stats.last_update },
            });
          }
          lastHash = currentHash;
        }
      } catch (error) {
        log.error({ err: error, reportId }, '轮询检查失败');
      }
    };

    // 立即执行一次
    check();

    const interval = setInterval(check, intervalMs);
    this.refreshInterval.set(reportId, interval);
  }

  /**
   * 停止轮询
   */
  stopPolling(reportId: number): void {
    const interval = this.refreshInterval.get(reportId);
    if (interval) {
      clearInterval(interval);
      this.refreshInterval.delete(reportId);
    }
  }

  /**
   * 获取订阅者数量
   */
  getSubscriberCount(reportId: number): number {
    return this.subscribers.get(reportId)?.size || 0;
  }

  /**
   * 手动触发刷新（供导入/更新后调用）
   */
  triggerRefresh(reportId: number, userId: number, type: RefreshEvent['type'] = 'data_changed'): void {
    this.notify({
      type,
      reportId,
      userId,
      timestamp: new Date().toISOString(),
    });
  }
}

export type RefreshCallback = (event: RefreshEvent) => void;

export const refreshManager = RefreshManager.getInstance();

// 导出单例实例和类型
export default refreshManager;
