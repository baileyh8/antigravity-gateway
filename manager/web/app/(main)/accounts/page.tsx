'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { AlertIcon, PlusIcon, RefreshIcon, SearchIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { AddAccountDialog } from '@/components/accounts/add-account-dialog';
import { EditAccountDialog } from '@/components/accounts/edit-account-dialog';
import { AccountCard } from '@/components/accounts/account-card';
import { api, ApiError } from '@/lib/api';
import { applyAccountEnabledPatch } from '@/lib/account-state';
import { accountPlan, matchesAccountFilter } from '@/lib/account-presentation';
import { useAuth } from '@/lib/auth';
import type { Account, AccountsResponse, ProxySnapshot } from '@/lib/types';

const FILTERS = [{ id: 'all', label: '全部' }, { id: 'healthy', label: '健康' }, { id: 'tos', label: 'TOS' }, { id: 'error', label: '异常' }, { id: 'cooldown', label: '冷却' }, { id: 'unknown', label: '待核验' }, { id: 'enabled', label: '已启用' }, { id: 'disabled', label: '已暂停' }];

export default function AccountsPage() {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [proxies, setProxies] = useState<ProxySnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const { me } = useAuth();
  const canEdit = me?.role === 'admin';
  const [proxyError, setProxyError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState('');
  const [state, setState] = useState('all');
  const [editing, setEditing] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [confirm, setConfirm] = useState('');
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [togglingIds, setTogglingIds] = useState<string[]>([]);
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
    setProxyError(proxyResult.status === 'rejected');
    if (proxyResult.status === 'fulfilled') setProxies(proxyResult.value);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const items = useMemo(() => {
    const list = data?.items || [];
    const needle = query.trim().toLowerCase();
    return list.filter((account) => {
      if (!matchesAccountFilter(account, state)) return false;
      if (!needle) return true;
      const key = account.providerType === 'robin' ? `robin:${account.id}` : account.id;
      const proxyName = proxies?.proxies.find((proxy) => proxy.id === proxies.bindings[key])?.name || '';
      return `${account.emailMasked} ${account.id} ${account.note || ''} ${accountPlan(account)} ${proxyName}`.toLowerCase().includes(needle);
    });
  }, [data, query, state, proxies]);

  const handleSaved = useCallback((message: string) => {
    notify(message);
    void load();
  }, [load, notify]);

  async function toggleEnabled(account: Account) {
    if (togglingIds.includes(account.id)) return;
    const nextEnabled = !account.enabled;
    setTogglingIds((current) => [...current, account.id]);
    try {
      await api(`/accounts/${encodeURIComponent(account.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: nextEnabled, provider: account.providerType })
      });
      setData((current) => current ? { ...current, items: applyAccountEnabledPatch(current.items, account.id, nextEnabled) } : current);
      notify(`${nextEnabled ? '已启用' : '已暂停'} ${account.emailMasked || account.id}`);
      await load();
    } catch (err) {
      notify(err instanceof ApiError || err instanceof Error ? err.message : `${nextEnabled ? '启用' : '暂停'}失败`, true);
    } finally {
      setTogglingIds((current) => current.filter((id) => id !== account.id));
    }
  }

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
    const list = (data?.items || []).filter((account) => account.enabled);
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
        description="每个账号的状态、套餐、额度与出口，一页查看"
        actions={<>
          {canEdit ? <button className="btn" type="button" onClick={() => setAdding(true)}><PlusIcon size={14} />添加账号</button> : null}
          {canEdit ? <button className="btn ghost" type="button" onClick={batchRecheck} disabled={Boolean(batch) || Boolean(busyId) || !data?.items.some((account) => account.enabled)}>
            <RefreshIcon size={14} />{batch ? `重检 ${batch.done}/${batch.total}` : '重检启用账号'}
          </button> : null}
          <button className="btn ghost" type="button" onClick={() => void load()}><RefreshIcon size={14} />刷新</button>
        </>}
      />

      {error ? <div className="notice bad" style={{ marginBottom: 12 }}><AlertIcon size={16} /><span>{error}</span></div> : null}

      <section className="account-toolbar" aria-label="账号筛选">
        <div className="account-search">
          <SearchIcon size={16} />
          <input aria-label="搜索账号" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索邮箱、ID、套餐、代理或备注" />
        </div>
        <div className="account-filters" role="group" aria-label="筛选账号状态">
          {FILTERS.map((filter) => <button key={filter.id} type="button" aria-pressed={state === filter.id}
            className={`account-filter${state === filter.id ? ' on' : ''}`} onClick={() => setState(filter.id)}>
            {filter.label}<span>{(data?.items || []).filter((account) => matchesAccountFilter(account, filter.id)).length}</span>
          </button>)}
        </div>
      </section>
      {proxyError ? <div className="notice warn" role="status">代理信息读取失败，暂不能确认绑定出口。请刷新后重试。</div> : null}
      {loading && !data ? <div className="account-grid" aria-label="正在加载账号" aria-busy="true">{[0, 1, 2, 3].map((index) => <div className="skeleton account-card-skeleton" key={index} />)}</div>
        : items.length ? <div className="account-grid">
          {items.map((account) => <AccountCard key={account.id} account={account} proxies={proxies} proxyError={proxyError} now={now} canEdit={canEdit}
            toggling={togglingIds.includes(account.id)} checking={busyId === account.id} recheckBlocked={Boolean(busyId) || Boolean(batch)}
            onToggle={() => void toggleEnabled(account)} onEdit={() => setEditing(account)} onRecheck={() => void recheck(account)}
            onDelete={() => { setDeleting(account); setConfirm(''); }} />)}
        </div> : <div className="panel account-empty"><h2>{error ? '暂时无法读取账号' : data?.items.length ? '没有匹配的账号' : '还没有账号'}</h2>
          <p>{error ? '请刷新后重试。' : data?.items.length ? '试试其他筛选条件，或清空搜索。' : '添加账号后，可在这里查看状态与额度。'}</p>
          {query || state !== 'all' ? <button className="btn ghost" type="button" onClick={() => { setQuery(''); setState('all'); }}>清除筛选</button> : null}
        </div>}
      <div className="footer"><span>健康状态与启停分别显示 · 代理管理位于设置 · 额度按上游分组展示</span><span>显示 {items.length} / {data?.items.length || 0} 个账号</span></div>

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
