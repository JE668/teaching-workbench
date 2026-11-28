import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * 实时数据刷新 Hook
 * 支持 SSE (Server-Sent Events) 连接，自动重连，心跳检测
 */
export interface RefreshEvent {
  type: 'connected' | 'heartbeat' | 'report_created' | 'report_updated' | 'report_deleted' | 'data_changed';
  reportId: number;
  userId?: number;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export interface UseRefreshOptions {
  reportId: number | null;
  enabled?: boolean;
  onRefresh?: (event: RefreshEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  reconnectInterval?: number; // 重连间隔，默认 5000ms
  maxReconnectAttempts?: number; // 最大重连次数，默认 10
}

export interface UseRefreshReturn {
  isConnected: boolean;
  lastEvent: RefreshEvent | null;
  error: Error | null;
  reconnect: () => void;
  disconnect: () => void;
}

export function useRefresh({
  reportId,
  enabled = true,
  onRefresh,
  onConnect,
  onDisconnect,
  onError,
  reconnectInterval = 5000,
  maxReconnectAttempts = 10,
}: UseRefreshOptions): UseRefreshReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<RefreshEvent | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isManualDisconnectRef = useRef(false);
  const enabledRef = useRef(enabled);

  // 保持回调最新
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const connect = useCallback(() => {
    if (!reportId || !enabledRef.current) return;

    // 关闭现有连接
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // 构建 SSE URL
    const url = new URL('/api/renewal/refresh/stream', window.location.origin);
    url.searchParams.set('reportId', String(reportId));

    try {
      const es = new EventSource(url.toString(), { withCredentials: true });
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
        onConnect?.();
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as RefreshEvent;
          setLastEvent(data);
          
          // 忽略心跳事件
          if (data.type === 'heartbeat') return;
          
          onRefresh?.(data);
        } catch (err) {
          console.warn('Failed to parse SSE message:', err);
        }
      };

      es.onerror = (err) => {
        console.error('SSE connection error:', err);
        setIsConnected(false);
        setError(new Error('SSE connection failed'));
        onError?.(new Error('SSE connection failed'));
        onDisconnect?.();

        // 自动重连逻辑
        if (!isManualDisconnectRef.current && enabledRef.current && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = reconnectInterval * Math.min(reconnectAttemptsRef.current, 5); // 指数退避，最多 5 倍
          
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setError(new Error('Max reconnection attempts reached'));
          onError?.(new Error('Max reconnection attempts reached'));
        }
      };
    } catch (err) {
      setError(err as Error);
      onError?.(err as Error);
    }
  }, [reportId, onRefresh, onConnect, onDisconnect, onError, reconnectInterval, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    isManualDisconnectRef.current = true;
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    setIsConnected(false);
    onDisconnect?.();
  }, [onDisconnect]);

  const reconnect = useCallback(() => {
    isManualDisconnectRef.current = false;
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  // 组件挂载/卸载时连接/断开
  useEffect(() => {
    if (reportId && enabled) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [reportId, enabled, connect, disconnect]);

  // 当 enabled 变化时处理
  useEffect(() => {
    if (enabled && reportId) {
      connect();
    } else if (!enabled) {
      disconnect();
    }
  }, [enabled, reportId, connect, disconnect]);

  return {
    isConnected,
    lastEvent,
    error,
    reconnect,
    disconnect,
  };
}

/**
 * 轮询降级 Hook - 当 SSE 不可用时使用
 */
export interface UsePollingOptions {
  reportId: number | null;
  enabled?: boolean;
  interval?: number; // 轮询间隔，默认 30000ms
  onRefresh?: (event: RefreshEvent) => void;
}

export interface UsePollingReturn {
  isPolling: boolean;
  lastEvent: RefreshEvent | null;
  error: Error | null;
  start: () => void;
  stop: () => void;
}

export function usePolling({
  reportId,
  enabled = true,
  interval = 30000,
  onRefresh,
}: UsePollingOptions): UsePollingReturn {
  const [isPolling, setIsPolling] = useState(false);
  const [lastEvent, setLastEvent] = useState<RefreshEvent | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastHashRef = useRef<string>('');

  const fetchData = useCallback(async () => {
    if (!reportId) return;

    try {
      // 这里可以调用后端的状态检查接口，或者直接重新获取看板数据
      // 为了通用性，我们发送一个通用的刷新事件
      const response = await fetch(`/api/renewal/analytics/rate-overview?reportId=${reportId}`, {
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Failed to fetch');
      
      const data = await response.json();
      const hash = JSON.stringify(data);
      
      if (lastHashRef.current && hash !== lastHashRef.current) {
        const event: RefreshEvent = {
          type: 'data_changed',
          reportId,
          timestamp: new Date().toISOString(),
          payload: data,
        };
        setLastEvent(event);
        onRefresh?.(event);
      }
      
      lastHashRef.current = hash;
      setError(null);
    } catch (err) {
      setError(err as Error);
    }
  }, [reportId, onRefresh]);

  const start = useCallback(() => {
    if (intervalRef.current) return;
    
    setIsPolling(true);
    fetchData(); // 立即执行一次
    
    intervalRef.current = setInterval(fetchData, interval);
  }, [fetchData, interval]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  useEffect(() => {
    if (enabled && reportId) {
      start();
    } else {
      stop();
    }

    return () => stop();
  }, [enabled, reportId, start, stop]);

  return {
    isPolling,
    lastEvent,
    error,
    start,
    stop,
  };
}

/**
 * 组合 Hook - 优先使用 SSE，失败时降级到轮询
 */
export interface UseAutoRefreshOptions {
  reportId: number | null;
  enabled?: boolean;
  onRefresh?: (event: RefreshEvent) => void;
  preferSSE?: boolean;
}

export interface UseAutoRefreshReturn {
  isConnected: boolean;
  isPolling: boolean;
  lastEvent: RefreshEvent | null;
  error: Error | null;
  refresh: () => void;
}

export function useAutoRefresh({
  reportId,
  enabled = true,
  onRefresh,
  preferSSE = true,
}: UseAutoRefreshOptions): UseAutoRefreshReturn {
  const sse = useRefresh({
    reportId,
    enabled: enabled && preferSSE,
    onRefresh,
  });

  const polling = usePolling({
    reportId,
    enabled: enabled && (!preferSSE || !sse.isConnected),
    onRefresh,
  });

  const refresh = useCallback(() => {
    // 手动触发刷新
    if (reportId) {
      fetch(`/api/renewal/refresh/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reportId }),
      }).catch(console.error);
    }
  }, [reportId]);

  return {
    isConnected: sse.isConnected,
    isPolling: polling.isPolling,
    lastEvent: sse.lastEvent || polling.lastEvent,
    error: sse.error || polling.error,
    refresh,
  };
}

export default useRefresh;
