const BASE_URL = '/api';

class ApiClient {
  private token: string | null = null;
  private user: any = null;

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
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || '上传失败');
    }
    return response.json();
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
