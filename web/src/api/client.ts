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
