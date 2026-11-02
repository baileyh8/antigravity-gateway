'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BASE_PATH } from '@/lib/base-path';

export default function LoginPage() {
  const { me, loading, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && me) window.location.replace(`${BASE_PATH}/dashboard/`);
  }, [loading, me]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      window.location.replace(`${BASE_PATH}/dashboard/`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-mark">A</div>
          <div>
            <h1>agy-manager</h1>
            <p>Antigravity Gateway 管理后台</p>
          </div>
        </div>
        <form className="form" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="username">用户名</label>
            <input
              id="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <button className="btn" type="submit" disabled={submitting}>
            {submitting ? '正在登录…' : '登录'}
          </button>
        </form>
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <div className="login-foot">仅限授权管理员访问 · 连续失败会临时锁定</div>
      </div>
    </main>
  );
}
