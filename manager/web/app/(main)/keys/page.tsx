'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { AlertIcon, KeyIcon, PlusIcon, RefreshIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { api, ApiError } from '@/lib/api';
import { fmtCompact, fmtNumber, fmtRelative } from '@/lib/format';
import type { ApiKey, KeysResponse } from '@/lib/types';

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function todayUsage(key: ApiKey) {
  return key.usage.byDay?.[todayKey()] || { requests: 0, tokens: 0 };
}

function expired(key: ApiKey) {
  return Boolean(key.expiresAt && Date.parse(key.expiresAt) <= Date.now());
}

function quotaExceeded(key: ApiKey) {
  return (key.quota.tokens > 0 && key.usage.tokens >= key.quota.tokens)
    || (key.quota.requests > 0 && key.usage.requests >= key.quota.requests);
}

function statusOf(key: ApiKey) {
  if (!key.enabled) return { text: '已停用', cls: '' };
  if (expired(key)) return { text: '已过期', cls: 'red' };
  if (quotaExceeded(key)) return { text: '限额用完', cls: 'amber' };
  return { text: '正常', cls: 'green' };
}

function splitLines(value: string) {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

type CreateForm = {
  name: string;
  days: string;
  models: string;
  ips: string;
  tokens: string;
  requests: string;
  rate: string;
  note: string;
};

const emptyCreate: CreateForm = { name: '', days: '0', models: '', ips: '', tokens: '0', requests: '0', rate: '120', note: '' };

export default function KeysPage() {
  const [data, setData] = useState<KeysResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyCreate);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [deleting, setDeleting] = useState<ApiKey | null>(null);
  const [confirm, setConfirm] = useState('');
  const [rolling, setRolling] = useState<ApiKey | null>(null);
  const [busy, setBusy] = useState('');
  const [secret, setSecret] = useState<{ title: string; value: string; name: string } | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);

  const notify = useCallback((text: string, isError = false) => setToast({ text, error: isError }), []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 3800); return () => window.clearTimeout(timer); }, [toast]);

  const load = useCallback(async () => {
    try {
      const next = await api<KeysResponse>('/keys');
      setData(next);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '无法读取密钥列表');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const keys = data?.keys || [];
  const summary = useMemo(() => {
    const active = keys.filter((key) => key.enabled && !expired(key)).length;
    const todayTokens = keys.reduce((sum, key) => sum + (todayUsage(key).tokens || 0), 0);
    const todayRequests = keys.reduce((sum, key) => sum + (todayUsage(key).requests || 0), 0);
    const nearLimit = keys.filter((key) => key.enabled && quotaExceeded(key)).length;
    return { active, todayTokens, todayRequests, nearLimit };
  }, [keys]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      const days = Number(form.days) || 0;
      const result = await api<{ key: ApiKey; secret: string }>('/keys', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          expiresAt: days > 0 ? new Date(Date.now() + days * 86400_000).toISOString() : null,
          models: splitLines(form.models),
          ipAllowlist: splitLines(form.ips),
          quota: { tokens: Number(form.tokens) || 0, requests: Number(form.requests) || 0 },
          ratePerMin: Number(form.rate) || 0,
          note: form.note
        })
      });
      setCreateOpen(false);
      setForm(emptyCreate);
      setSecret({ title: '密钥已创建', value: result.secret, name: result.key.name });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '创建失败', true);
    } finally {
      setCreating(false);
    }
  }

  async function toggle(key: ApiKey) {
    setBusy(`toggle-${key.id}`);
    try {
      await api(`/keys/${encodeURIComponent(key.id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: !key.enabled }) });
      notify(key.enabled ? '密钥已停用' : '密钥已启用');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '更新失败', true);
    } finally {
      setBusy('');
    }
  }

  async function roll() {
    if (!rolling) return;
    setBusy(`roll-${rolling.id}`);
    try {
      const result = await api<{ key: ApiKey; secret: string }>(`/keys/${encodeURIComponent(rolling.id)}/roll`, { method: 'POST' });
      setRolling(null);
      setSecret({ title: '密钥已滚动重置', value: result.secret, name: result.key.name });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '滚动重置失败', true);
    } finally {
      setBusy('');
    }
  }

  async function resetUsage(key: ApiKey) {
    if (!window.confirm(`重置「${key.name}」的累计用量？`)) return;
    setBusy(`reset-${key.id}`);
    try {
      await api(`/keys/${encodeURIComponent(key.id)}/reset-usage`, { method: 'POST' });
      notify('用量已重置');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '重置失败', true);
    } finally {
      setBusy('');
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(`delete-${deleting.id}`);
    try {
      await api(`/keys/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' });
      setDeleting(null);
      setConfirm('');
      notify('密钥已删除');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '删除失败', true);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <PageHeader
        title="密钥"
        description="对外分发的调用凭据 · 支持有效期、模型 / IP 白名单、配额与限流"
        actions={<>
          <button className="btn" type="button" onClick={() => setCreateOpen(true)}><PlusIcon size={14} />新建密钥</button>
          <button className="btn ghost" type="button" onClick={() => void load()}><RefreshIcon size={14} />刷新</button>
        </>}
      />

      {error ? <div className="notice bad" style={{ marginBottom: 12 }}><AlertIcon size={16} /><span>{error}</span></div> : null}
      {data && !data.multiKey ? <div className="notice warn" style={{ marginBottom: 12 }}><span>多密钥模式未启用，当前只接受基座环境变量主密钥。</span></div> : null}

      <div className="cards c4">
        <div className="card"><div className="stat-label">活跃密钥<KeyIcon size={14} /></div><div className="stat-value">{summary.active}</div><div className="stat-hint">共 {keys.length} 把</div></div>
        <div className="card"><div className="stat-label">今日 Token</div><div className="stat-value">{fmtCompact(summary.todayTokens)}</div><div className="stat-hint">按密钥归属</div></div>
        <div className="card"><div className="stat-label">今日请求</div><div className="stat-value">{fmtCompact(summary.todayRequests)}</div><div className="stat-hint">客户端请求</div></div>
        <div className="card"><div className="stat-label">限额用完</div><div className="stat-value">{summary.nearLimit}</div><div className="stat-hint">需要调整配额或重置</div></div>
      </div>

      <div className="panel" style={{ marginTop: 12, padding: '8px 12px 4px' }}>
        {loading && !data ? <div className="skeleton" style={{ height: 220 }} /> : (
          <table className="table">
            <thead><tr><th>名称</th><th>前缀</th><th>状态</th><th>有效期</th><th>限制</th><th>用量 / 配额</th><th>最近使用</th><th>操作</th></tr></thead>
            <tbody>
              {keys.map((key) => {
                const status = statusOf(key);
                const today = todayUsage(key);
                return (
                  <tr key={key.id}>
                    <td><div className="strong">{key.name}</div>{key.note ? <div className="muted tiny">{key.note}</div> : null}</td>
                    <td className="muted">{key.prefix}</td>
                    <td><span className={`badge ${status.cls}`}>{status.text}</span></td>
                    <td className="muted">{key.expiresAt ? new Date(key.expiresAt).toLocaleDateString('zh-CN') : '永久'}</td>
                    <td><div className="key-limits"><span className="badge">{key.models.length ? `${key.models.length} 个模型` : '全部模型'}</span><span className="badge">{key.ipAllowlist.length ? `${key.ipAllowlist.length} 个 IP` : '不限 IP'}</span>{key.ratePerMin ? <span className="badge">{key.ratePerMin}/分</span> : null}</div></td>
                    <td className="key-usage">
                      <div>{fmtCompact(key.usage.tokens)} / {key.quota.tokens ? fmtCompact(key.quota.tokens) : '不限'} Token</div>
                      <div className="muted tiny">{fmtCompact(key.usage.requests)} / {key.quota.requests ? fmtCompact(key.quota.requests) : '不限'} 请求 · 今日 {fmtCompact(today.requests)}</div>
                    </td>
                    <td className="muted">{key.lastUsedAt ? fmtRelative(key.lastUsedAt) : '未使用'}</td>
                    <td>
                      <div className="table-actions">
                        <button className="btn ghost small" type="button" onClick={() => setEditing(key)}>编辑</button>
                        <button className="btn ghost small" type="button" onClick={() => void toggle(key)} disabled={Boolean(busy)}>{key.enabled ? '停用' : '启用'}</button>
                        <details className="details-menu">
                          <summary>更多</summary>
                          <div className="menu">
                            <button type="button" onClick={() => setRolling(key)}>滚动重置</button>
                            <button type="button" onClick={() => void resetUsage(key)}>重置用量</button>
                            <button className="danger" type="button" onClick={() => { setDeleting(key); setConfirm(''); }}>删除</button>
                          </div>
                        </details>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!keys.length ? <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 30 }}>还没有密钥</td></tr> : null}
            </tbody>
          </table>
        )}
      </div>
      <div className="footer"><span>完整密钥只在创建或滚动时显示一次 · 日志与审计只记前缀</span><span>共 {keys.length} 把</span></div>

      {createOpen ? (
        <Modal title="新建密钥" description="创建后只显示一次完整密钥，请立即保存。" onClose={() => setCreateOpen(false)} footer={<>
          <button className="btn ghost" type="button" onClick={() => setCreateOpen(false)}>取消</button>
          <button className="btn" type="submit" form="create-key-form" disabled={creating}>{creating ? '创建中…' : '创建'}</button>
        </>}>
          <form id="create-key-form" className="form-grid" onSubmit={create}>
            <div className="field"><label htmlFor="key-name">名称</label><input id="key-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={64} required /></div>
            <div className="form-row">
              <div className="field"><label htmlFor="key-days">有效期（天，0 = 永久）</label><input id="key-days" type="number" min={0} value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} /></div>
              <div className="field"><label htmlFor="key-rate">每分钟请求上限（0 = 不限）</label><input id="key-rate" type="number" min={0} value={form.rate} onChange={(event) => setForm({ ...form, rate: event.target.value })} /></div>
            </div>
            <div className="form-row">
              <div className="field"><label htmlFor="key-tokens">Token 配额（0 = 不限）</label><input id="key-tokens" type="number" min={0} value={form.tokens} onChange={(event) => setForm({ ...form, tokens: event.target.value })} /></div>
              <div className="field"><label htmlFor="key-requests">请求配额（0 = 不限）</label><input id="key-requests" type="number" min={0} value={form.requests} onChange={(event) => setForm({ ...form, requests: event.target.value })} /></div>
            </div>
            <div className="field"><label htmlFor="key-models">模型白名单（逗号或换行，留空 = 全部）</label><textarea id="key-models" value={form.models} onChange={(event) => setForm({ ...form, models: event.target.value })} /></div>
            <div className="field"><label htmlFor="key-ips">IP 白名单（支持 CIDR，留空 = 不限）</label><textarea id="key-ips" value={form.ips} onChange={(event) => setForm({ ...form, ips: event.target.value })} /></div>
            <div className="field"><label htmlFor="key-note">备注</label><input id="key-note" value={form.note} maxLength={200} onChange={(event) => setForm({ ...form, note: event.target.value })} /></div>
          </form>
        </Modal>
      ) : null}

      {editing ? <EditKeyDialog key={editing.id} item={editing} onClose={() => setEditing(null)} onSaved={(message) => { notify(message); void load(); }} /> : null}

      {rolling ? (
        <Modal title="滚动重置密钥" description={`「${rolling.name}」的旧密钥会立即失效，客户端需要换成新密钥。`} onClose={() => setRolling(null)} footer={<>
          <button className="btn ghost" type="button" onClick={() => setRolling(null)}>取消</button>
          <button className="btn" type="button" onClick={roll} disabled={Boolean(busy)}>{busy ? '重置中…' : '确认重置'}</button>
        </>}>
          <div className="notice warn"><span>重置后只显示一次新密钥；请确认可以更新所有使用该密钥的客户端。</span></div>
        </Modal>
      ) : null}

      {deleting ? (
        <Modal title="删除密钥" description={`这会立即让「${deleting.name}」失效。`} onClose={() => setDeleting(null)} footer={<>
          <button className="btn ghost" type="button" onClick={() => setDeleting(null)}>取消</button>
          <button className="btn danger" type="button" onClick={remove} disabled={Boolean(busy) || confirm !== deleting.name}>{busy ? '删除中…' : '确认删除'}</button>
        </>}>
          <div className="form-grid"><div className="field"><label htmlFor="delete-key">输入密钥名称 <b>{deleting.name}</b> 确认</label><input id="delete-key" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" /></div></div>
        </Modal>
      ) : null}

      {secret ? (
        <Modal title={secret.title} description="这是唯一一次显示完整密钥，关闭后只能滚动重置。" onClose={() => setSecret(null)} footer={<>
          <button className="btn ghost" type="button" onClick={() => { void navigator.clipboard.writeText(secret.value).catch(() => {}); }}>复制</button>
          <button className="btn" type="button" onClick={() => setSecret(null)}>我已保存</button>
        </>}>
          <div className="form-grid">
            <div className="tiny muted">{secret.name}</div>
            <div className="secret-box">{secret.value}</div>
            <div className="notice warn"><span>请立即保存到客户端配置。管理后台只保存哈希，无法再次查看。</span></div>
          </div>
        </Modal>
      ) : null}

      {toast ? <div className={`toast${toast.error ? ' error' : ''}`} role="status">{toast.text}</div> : null}
    </>
  );
}

function EditKeyDialog({ item, onClose, onSaved }: { item: ApiKey; onClose: () => void; onSaved: (message: string) => void }) {
  const [name, setName] = useState(item.name);
  const [enabled, setEnabled] = useState(item.enabled);
  const [date, setDate] = useState(item.expiresAt ? item.expiresAt.slice(0, 10) : '');
  const [models, setModels] = useState(item.models.join('\n'));
  const [ips, setIps] = useState(item.ipAllowlist.join('\n'));
  const [tokens, setTokens] = useState(String(item.quota.tokens));
  const [requests, setRequests] = useState(String(item.quota.requests));
  const [rate, setRate] = useState(String(item.ratePerMin));
  const [note, setNote] = useState(item.note || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api(`/keys/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          enabled,
          expiresAt: date ? new Date(`${date}T23:59:59`).toISOString() : null,
          models: splitLines(models),
          ipAllowlist: splitLines(ips),
          quota: { tokens: Number(tokens) || 0, requests: Number(requests) || 0 },
          ratePerMin: Number(rate) || 0,
          note
        })
      });
      onSaved('密钥设置已保存');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="编辑密钥" description={item.prefix} onClose={onClose} footer={<>
      <button className="btn ghost" type="button" onClick={onClose}>取消</button>
      <button className="btn" type="button" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
    </>}>
      <div className="form-grid">
        <div className="form-row">
          <div className="field"><label htmlFor="edit-key-name">名称</label><input id="edit-key-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={64} /></div>
          <div className="switch-row"><span>启用</span><button className={`switch${enabled ? ' on' : ''}`} type="button" role="switch" aria-checked={enabled} onClick={() => setEnabled(!enabled)} /></div>
        </div>
        <div className="form-row">
          <div className="field"><label htmlFor="edit-key-date">有效期（留空 = 永久）</label><input id="edit-key-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
          <div className="field"><label htmlFor="edit-key-rate">每分钟请求上限</label><input id="edit-key-rate" type="number" min={0} value={rate} onChange={(event) => setRate(event.target.value)} /></div>
        </div>
        <div className="form-row">
          <div className="field"><label htmlFor="edit-key-tokens">Token 配额</label><input id="edit-key-tokens" type="number" min={0} value={tokens} onChange={(event) => setTokens(event.target.value)} /></div>
          <div className="field"><label htmlFor="edit-key-requests">请求配额</label><input id="edit-key-requests" type="number" min={0} value={requests} onChange={(event) => setRequests(event.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="edit-key-models">模型白名单</label><textarea id="edit-key-models" value={models} onChange={(event) => setModels(event.target.value)} /></div>
        <div className="field"><label htmlFor="edit-key-ips">IP 白名单</label><textarea id="edit-key-ips" value={ips} onChange={(event) => setIps(event.target.value)} /></div>
        <div className="field"><label htmlFor="edit-key-note">备注</label><input id="edit-key-note" value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} /></div>
        {error ? <div className="login-error">{error}</div> : null}
      </div>
    </Modal>
  );
}
