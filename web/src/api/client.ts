const BASE_URL = '/api';

type UnauthorizedHandler = () => void;

class ApiClient {
  private token: string | null = null;
  private user: any = null;
  private onUnauthorized: UnauthorizedHandler | null = null;

  /**
   * 注册「登录态失效」回调（由 AuthProvider 注入）。
   * 作用：任何请求收到 401 时统一清掉本地登录态并跳回登录页，
   * 而不是在页面上弹一句"认证令牌无效"让用户摸不着头脑。
   */
  setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
    this.onUnauthorized = handler;
  }

  /** 登录/注册接口自身的 401 是「账号或密码错误」，不能当成掉线 */
  private isAuthPath(path: string) {
    return path.startsWith('/auth/login') || path.startsWith('/auth/register');
  }

  /**
   * 统一的 401 处理。
   * 仅当"本次请求确实带了令牌"且"不是登录/注册接口"时才触发，
   * 避免密码输错就把会话清掉。
   */
  private handleUnauthorized(path: string, hadToken: boolean) {
    if (!hadToken || this.isAuthPath(path)) return;
    this.clearAuth();
    this.onUnauthorized?.();
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem('token', token);
  }

  setTokenFromStorage() {
    this.token = localStorage.getItem('token');
    this.user = localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!) : null;
  }

  getUser() {
    return this.user;
  }

  setUser(user: any) {
    this.user = user;
    localStorage.setItem('user', JSON.stringify(user));
  }

  clearAuth() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  getToken(): string | null {
    return this.token;
  }

  async request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
    };

    if (this.token) {
      headers['Authorization'] = 'Bearer ' + this.token;
    }

    const response = await fetch(BASE_URL + path, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 401) {
        this.handleUnauthorized(path, !!this.token);
      }
      throw new Error(errorData.error || '请求失败');
    }

    return response.json();
  }

  async upload<T = any>(path: string, formData: FormData): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = 'Bearer ' + this.token;
    }
    const response = await fetch(BASE_URL + path, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!response.ok) {
      // 注意：反向代理层（nginx / Lucky 等）拒绝时返回的是 HTML 错误页，
      // 解析 JSON 会失败。此时必须把 HTTP 状态带出来，
      // 否则用户只看到笼统的"上传失败"，无从排查。
      const errorData = await response.json().catch(() => ({} as any));

      if (response.status === 401) {
        this.handleUnauthorized(path, !!this.token);
      }

      if (errorData?.error) throw new Error(errorData.error);

      if (response.status === 413) {
        throw new Error('图片过大被拒绝，单张不能超过 40MB（可能是反向代理的体积限制）');
      }
      throw new Error('上传失败（HTTP ' + response.status + '）');
    }
    return response.json();
  }

  /**
   * GET 并以 SSE 流式接收（用于跨设备草稿同步）。
   *
   * 为什么不用 EventSource：它无法携带 Authorization 头，
   * 而我们的鉴权是 JWT 头（非 cookie）。用 fetch 流即可带上头。
   */
  async streamGet(
    path: string,
    handlers: { onEvent?: (event: string, data: any) => void; onOpen?: () => void },
    signal?: AbortSignal
  ): Promise<void> {
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;

    const res = await fetch(BASE_URL + path, { method: 'GET', headers, signal });

    if (!res.ok) {
      if (res.status === 401) {
        this.handleUnauthorized(path, !!this.token);
      }
      throw new Error('订阅失败: ' + res.status);
    }
    if (!res.body) {
      throw new Error('当前环境不支持流式响应');
    }

    handlers.onOpen?.();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const dispatch = (frame: string) => {
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) return;

      let data: any = null;
      try {
        data = JSON.parse(dataLines.join('\n'));
      } catch {
        return;
      }
      handlers.onEvent?.(event, data);
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        // 冲掉可能残留的最后一帧
        if (buffer.trim()) dispatch(buffer);
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // SSE 以空行分帧；注意分隔符可能被网络切成两半
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (frame.trim()) dispatch(frame);
      }
    }
  }

  /**
   * POST 并以 SSE 流式接收（用于 AI 生成）。
   * 事件：delta | regenerating | done | error
   */
  async streamPost(
    path: string,
    body: any,
    handlers: {
      onDelta?: (text: string) => void;
      onRegenerating?: (wordCount: number) => void;
      onDone?: (payload: { content: string; wordCount: number; regenerated: boolean }) => void;
      onError?: (message: string) => void;
    },
    signal?: AbortSignal
  ): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;

    const res = await fetch(BASE_URL + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({} as any));
      if (res.status === 401) {
        this.handleUnauthorized(path, !!this.token);
      }
      throw new Error(err.error || '请求失败');
    }
    if (!res.body) {
      throw new Error('当前环境不支持流式响应');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;

    const dispatch = (frame: string) => {
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) return;

      let data: any = null;
      try {
        data = JSON.parse(dataLines.join('\n'));
      } catch {
        return;
      }

      if (event === 'delta' && handlers.onDelta) handlers.onDelta(data.text || '');
      else if (event === 'regenerating' && handlers.onRegenerating) handlers.onRegenerating(data.wordCount);
      else if (event === 'done') {
        finished = true;
        handlers.onDone?.(data);
      } else if (event === 'error') {
        finished = true;
        handlers.onError?.(data.error || '生成失败');
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (frame.trim()) dispatch(frame);
        }
      }
      // 处理末尾可能残留的帧
      if (buffer.trim()) dispatch(buffer);
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }

    // 流结束但既没 done 也没 error，说明被中断
    if (!finished) {
      handlers.onError?.('生成中断，请重试');
    }
  }

  /** 下载文件（返回 Blob，供前端另存） */
  async download(path: string): Promise<Blob> {
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;

    const res = await fetch(BASE_URL + path, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({} as any));
      if (res.status === 401) {
        this.handleUnauthorized(path, !!this.token);
      }
      throw new Error(err.error || '下载失败');
    }
    return res.blob();
  }

  get(path: string) {
    return this.request(path);
  }

  post(path: string, body: any) {
    return this.request(path, { method: 'POST', body: JSON.stringify(body) });
  }

  put(path: string, body: any) {
    return this.request(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  delete(path: string) {
    return this.request(path, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
