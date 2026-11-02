'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { AlertIcon, PlusIcon, RefreshIcon, SearchIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { QuotaChips } from '@/components/quota-chips';
import { QuotaGroupCell, QuotaLowest } from '@/components/quota-cell';
import { AddAccountDialog } from '@/components/accounts/add-account-dialog';
import { EditAccountDialog } from '@/components/accounts/edit-account-dialog';
import { ProxyPanel } from '@/components/accounts/proxy-panel';
import { api, ApiError } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { lowestByKind, lowestOverall, poolSummary, quotaMatrix } from '@/lib/quota';
import type { Account, AccountsResponse, ProxySnapshot } from '@/lib/types';

function StateBadge({ state }: { state: string }) {
  if (state === 'available') return <span className="badge green"><span className="dot" />可用</span>;
  if (state === 'cooldown') return <span className="badge amber"><span className="dot amber" />冷却</span>;
  if (state === 'disabled') return <span className="badge"><span className="dot gray" />已禁用</span>;
  return <span className="badge red"><span className="dot red" />异常</span>;
}

export default function AccountsPage() {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [proxies, setProxies] = useState<ProxySnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'accounts' | 'quota' | 'proxies'>('accounts');
  const [query, setQuery] = useState('');
  const [state, setState] = useState('all');
  const [editing, setEditing] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [confirm, setConfirm] = useState('');
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);

  const notify = useCallback((text: string, isError = false) => setToast({ text, error: isError }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const load = useCallback(async () => {
    const [accountResult, proxyResult] = await Promise.allSettled([
      api<AccountsResponse>('/accounts'),
      api<ProxySnapshot>('/proxies')
    ]);
    if (accountResult.status === 'fulfilled') {
      setData(accountResult.value);
      setError('');
    } else {
      setError(accountResult.reason instanceof ApiError ? accountResult.reason.message : '无法读取账号列表');
    }
    if (proxyResult.status === 'fulfilled') setProxies(proxyResult.value);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => {
    const list = data?.items || [];
    const needle = query.trim().toLowerCase();
    return list.filter((account) => {
      if (state !== 'all' && account.state !== state) return false;
      if (!needle) return true;
      return `${account.emailMasked} ${account.id} ${account.note || ''}`.toLowerCase().includes(needle);
    });
  }, [data, query, state]);

  const handleSaved = useCallback((message: string) => {
    notify(message);
    void load();
  }, [load, notify]);

  async function recheck(account: Account) {
    setBusyId(account.id);
    try {
      await api(`/accounts/${encodeURIComponent(account.id)}/recheck`, {
        method: 'POST',
        body: JSON.stringify({ provider: account.providerType })
      });
      notify('重检完成');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '重检失败', true);
    } finally {
      setBusyId('');
    }
  }

  async function batchRecheck() {
    const list = [...(data?.items || [])];
    if (!list.length) return;
    setBatch({ done: 0, total: list.length });
    const queue = [...list];
    const worker = async () => {
      while (queue.length) {
        const account = queue.shift();
        if (!account) return;
        try {
          await api(`/accounts/${encodeURIComponent(account.id)}/recheck`, {
            method: 'POST',
            body: JSON.stringify({ provider: account.providerType })
          });
        } catch { /* per-account failures are reflected in the refreshed list */ }
        setBatch((current) => current ? { ...current, done: current.done + 1 } : current);
      }
    };
    await Promise.all([worker(), worker()]);
    setBatch(null);
    notify('批量重检完成');
    await load();
  }

  async function remove() {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await api(`/accounts/${encodeURIComponent(deleting.id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirm: confirm.trim(), provider: deleting.providerType })
      });
      setDeleting(null);
      setConfirm('');
      notify('账号已删除');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '删除失败', true);
    } finally {
      setDeletingBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="账号"
        description="账号启停、权重、备注、代理与 OAuth 添加 · 写操作全部审计"
        actions={<>
          <button className="btn" type="button" onClick={() => setAdding(true)}><PlusIcon size={14} />添加账号</button>
          <button className="btn ghost" type="button" onClick={batchRecheck} disabled={Boolean(batch) || !data?.items.length}>
            <RefreshIcon size={14} />{batch ? `重检 ${batch.done}/${batch.total}` : '批量重检'}
          </button>
          <button className="btn ghost" type="button" onClick={() => void load()}><RefreshIcon size={14} />刷新</button>
        </>}
      />

      {error ? <div className="notice bad" style={{ marginBottom: 12 }}><AlertIcon size={16} /><span>{error}</span></div> : null}

      <div className="tabs">
        <button className={tab === 'accounts' ? 'on' : ''} type="button" onClick={() => setTab('accounts')}>账号</button>
        <button className={tab === 'quota' ? 'on' : ''} type="button" onClick={() => setTab('quota')}>额度</button>
        <button className={tab === 'proxies' ? 'on' : ''} type="button" onClick={() => setTab('proxies')}>代理</button>
      </div>

      {tab === 'accounts' ? (
        <>
          <div className="panel" style={{ padding: '10px 12px', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
              <SearchIcon size={14} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--muted)' }} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索邮箱、账号 ID 或备注"
                style={{ width: '100%', height: 34, border: '1px solid rgba(24,24,27,.1)', borderRadius: 10, padding: '0 10px 0 32px', background: '#fff', fontSize: 12, outline: 'none' }}
              />
            </div>
            <select value={state} onChange={(event) => setState(event.target.value)} style={{ height: 34, border: '1px solid rgba(24,24,27,.1)', borderRadius: 10, padding: '0 10px', background: '#fff', fontSize: 12 }}>
              <option value="all">全部状态</option>
              <option value="available">可用</option>
              <option value="cooldown">冷却</option>
              <option value="disabled">已禁用</option>
              <option value="error">异常</option>
            </select>
          </div>

          <div className="panel" style={{ padding: '8px 12px 4px' }}>
            {loading && !data ? (
              <div className="skeleton" style={{ height: 220 }} />
            ) : (
              <table className="table">
                <thead><tr><th>账号</th><th>状态</th><th>权重</th><th>来源</th><th>最近成功</th><th>额度</th><th>备注</th><th>操作</th></tr></thead>
                <tbody>
                  {items.map((account) => {
                    return (
                      <tr key={account.id}>
                        <td><div className="strong">{account.emailMasked || account.id}</div></td>
                        <td><StateBadge state={account.state} /></td>
                        <td>{account.weight}</td>
                        <td className="muted">{account.providerType === 'robin' ? 'Gemini App' : 'Antigravity'}</td>
                        <td className="muted">{fmtRelative(account.lastSuccessAt)}</td>
                        <td><QuotaChips account={account} /></td>
                        <td className="note-cell" title={account.note || ''}>{account.note || '—'}</td>
                        <td>
                          <div className="table-actions">
                            <button className="btn ghost small" type="button" onClick={() => void recheck(account)} disabled={Boolean(busyId) || account.state === 'disabled'}>{busyId === account.id ? '检测中…' : '重检'}</button>
                            <button className="btn ghost small" type="button" onClick={() => setEditing(account)}>编辑</button>
                            <button className="btn danger small" type="button" onClick={() => { setDeleting(account); setConfirm(''); }}>删除</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!items.length ? (
                    <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 30 }}>没有匹配的账号</td></tr>
                  ) : null}
                </tbody>
              </table>
            )}
          </div>
          <div className="footer"><span>邮箱默认脱敏 · 备注只保存在管理后台 · 删除需输入脱敏邮箱确认</span><span>共 {items.length} 条</span></div>
        </>
      ) : tab === 'quota' ? (
        <div className="panel">
          <div className="panel-head">
            <div><h2>账号额度池</h2><p>按模型组展开：Gemini、Claude / GPT、Argon，显示每组最低的周 / 5h 额度。</p></div>
            <span className="badge">{items.length} 个账号</span>
          </div>
          <div className="quota-summary">
            {poolSummary(items).map(({ kind, label, best }) => {
              const covered = items.filter((account) => Boolean(lowestByKind(account)[kind])).length;
              return (
                <div className="quota-summary-item" key={kind}>
                  <span>{label}</span>
                  <b>{best ? `${Math.round(best.cell.fraction * 100)}%` : '—'}</b>
                  <small>{best ? `${best.account.emailMasked} · ${covered} 个账号` : '无数据'}</small>
                </div>
              );
            })}
            <div className="quota-summary-note">低于 20%：{items.filter((account) => Object.values(lowestByKind(account)).some((cell) => cell && cell.fraction < 0.2)).length} 个账号</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table quota-table" style={{ minWidth: 700 }}>
              <thead><tr><th>账号</th><th>Gemini</th><th>Claude / GPT</th><th>Argon</th><th>最低</th></tr></thead>
              <tbody>
                {items.map((account) => {
                  const matrix = quotaMatrix(account);
                  const lowest = lowestOverall(account);
                  return (
                    <tr key={account.id}>
                      <td><div className="strong">{account.emailMasked || account.id}</div><div className="muted tiny">{account.providerType === 'robin' ? 'Gemini App' : 'Antigravity'}</div></td>
                      <td><QuotaGroupCell fiveHour={matrix.gemini5h} weekly={matrix.geminiWeek} /></td>
                      <td><QuotaGroupCell fiveHour={matrix.claude5h} weekly={matrix.claudeWeek} /></td>
                      <td><QuotaGroupCell fiveHour={null} weekly={matrix.argonWeek} /></td>
                      <td><QuotaLowest cell={lowest} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="footer"><span>额度来自上游 quota 分组 · 周 / 5h 为剩余比例</span><span>{items.length} 个账号</span></div>
        </div>
      ) : (
        <ProxyPanel snapshot={proxies} onChanged={(message) => { notify(message); void load(); }} />
      )}

      {editing ? <EditAccountDialog account={editing} proxies={proxies} onClose={() => setEditing(null)} onSaved={handleSaved} /> : null}
      {adding ? <AddAccountDialog proxies={proxies} onClose={() => setAdding(false)} onAdded={handleSaved} /> : null}

      {deleting ? (
        <Modal
          title="删除账号"
          description={`这会删除 ${deleting.emailMasked || deleting.id} 的本地凭据，并立即停止调度。不可撤销。`}
          onClose={() => { if (!deletingBusy) setDeleting(null); }}
          footer={<>
            <button className="btn ghost" type="button" onClick={() => setDeleting(null)} disabled={deletingBusy}>取消</button>
            <button className="btn danger" type="button" onClick={remove} disabled={deletingBusy || !confirm.trim()}>{deletingBusy ? '删除中…' : '确认删除'}</button>
          </>}
        >
          <div className="form-grid">
            <div className="field">
              <label htmlFor="delete-confirm">输入 <b>{deleting.emailMasked || deleting.id}</b> 确认</label>
              <input id="delete-confirm" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" />
            </div>
          </div>
        </Modal>
      ) : null}

      {toast ? <div className={`toast${toast.error ? ' error' : ''}`} role="status">{toast.text}</div> : null}
    </>
  );
}
