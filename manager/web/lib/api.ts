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
const CSRF_CACHE_MS = 11 * 60 * 60 * 1000;
let csrfCache: { token: string; at: number } | null = null;
let csrfInflight: Promise<string> | null = null;

type Envelope<T> = { ok?: boolean; data?: T; error?: { code?: string; message?: string } };

async function getCsrfToken(force = false, signal?: AbortSignal | null): Promise<string> {
  if (!force && csrfCache && Date.now() - csrfCache.at < CSRF_CACHE_MS) {
    return csrfCache.token;
  }
  if (!force && csrfInflight) return csrfInflight;
  const loader = (async () => {
    const challenge = await fetch(`${API_BASE}/auth/csrf`, { credentials: 'same-origin', cache: 'no-store', signal });
    const payload = await challenge.json();
    if (!challenge.ok || !payload.data?.token) {
      throw new ApiError('会话校验失败，请重试。', 403, 'csrf_invalid');
    }
    const token = String(payload.data.token);
    csrfCache = { token, at: Date.now() };
    return token;
  })();
  csrfInflight = loader;
  try {
    return await loader;
  } finally {
    if (csrfInflight === loader) csrfInflight = null;
  }
}

export function clearApiCaches() {
  csrfCache = null;
  conditional.clear();
}

export async function api<T>(path: string, init: RequestInit = {}, _retriedCsrf = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const method = (init.method || 'GET').toUpperCase();
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (isMutation) {
    const token = await getCsrfToken(_retriedCsrf, init.signal);
    headers.set('X-Agy-Csrf', token);
    conditional.clear();
  } else if (conditional.has(path)) {
    headers.set('If-None-Match', conditional.get(path)!.etag);
  }
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
    if (isMutation && !_retriedCsrf && response.status === 403 && body?.error?.code === 'csrf_invalid') {
      csrfCache = null;
      return api<T>(path, init, true);
    }
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
