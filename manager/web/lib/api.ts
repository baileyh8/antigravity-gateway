import { API_BASE } from './base-path';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const conditional = new Map<string, { etag: string; value: unknown }>();

type Envelope<T> = { ok?: boolean; data?: T; error?: { code?: string; message?: string } };

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const method = (init.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const challenge = await fetch(`${API_BASE}/auth/csrf`, { credentials: 'same-origin', cache: 'no-store' });
    const payload = await challenge.json();
    if (!challenge.ok || !payload.data?.token) throw new ApiError('会话校验失败，请重试。', 403, 'csrf_invalid');
    headers.set('X-Agy-Csrf', payload.data.token);
    conditional.clear();
  } else if (conditional.has(path)) headers.set('If-None-Match', conditional.get(path)!.etag);
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers
  });
  if (response.status === 304 && conditional.has(path)) return conditional.get(path)!.value as T;
  if (!response.ok) conditional.delete(path);
  const text = await response.text();
  let body: Envelope<T> | null = null;
  try { body = text ? JSON.parse(text) as Envelope<T> : null; } catch { body = null; }
  if (!response.ok) {
    throw new ApiError(
      body?.error?.message || `请求失败（HTTP ${response.status}）`,
      response.status,
      body?.error?.code || ''
    );
  }
  const value = (body && 'data' in body ? body.data : body) as T;
  const etag = response.headers.get('etag');
  if (etag && method === 'GET') {
    if (conditional.size >= 32) conditional.delete(conditional.keys().next().value!);
    conditional.set(path, { etag, value });
  }
  return value;
}
