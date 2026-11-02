'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { AlertIcon, BoxesIcon, RefreshIcon, SearchIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { api, ApiError } from '@/lib/api';
import type { ModelEntry, ModelsResponse } from '@/lib/types';

function fmtContext(value: number | null) {
  if (!value) return '—';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value % (1024 * 1024) ? 1 : 0)}M`;
  if (value >= 1024) return `${Math.round(value / 1024)}K`;
  return String(value);
}

export default function ModelsPage() {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<ModelEntry | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);

  const notify = useCallback((text: string, isError = false) => setToast({ text, error: isError }), []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 3800); return () => window.clearTimeout(timer); }, [toast]);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const next = await api<ModelsResponse>(`/models${force ? '?force=1' : ''}`);
      setData(next);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '无法读取模型目录');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function discover() {
    setBusy('discover');
    try {
      await api('/models/discover', { method: 'POST' });
      notify('模型目录已重新发现');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '发现失败', true);
    } finally {
      setBusy('');
    }
  }

  async function testModel(id: string) {
    setBusy(id);
    try {
      const result = await api<{ latencyMs: number; text: string; usage?: { total_tokens?: number } }>(`/models/${encodeURIComponent(id)}/test`, { method: 'POST' });
      notify(`${result.latencyMs}ms · ${result.usage?.total_tokens || 0} Token · ${result.text || '无文本回复'}`);
    } catch (err) { notify(err instanceof Error ? err.message : '测试失败', true); }
    finally { setBusy(''); }
  }

  async function downloadCatalog(kind: 'codex' | 'claude') {
    try {
      const catalogs = await api<Record<string, unknown>>('/catalogs');
      const url = URL.createObjectURL(new Blob([JSON.stringify(catalogs[kind], null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `${kind}-models.json`; a.click(); URL.revokeObjectURL(url);
    } catch (err) { notify(err instanceof Error ? err.message : '下载失败', true); }
  }

  async function sync() {
    setBusy('sync');
    try {
      await api('/catalogs/sync', { method: 'POST' });
      notify('Codex / Claude 目录已同步');
    } catch (err) {
      notify(err instanceof Error ? err.message : '同步失败', true);
    } finally {
      setBusy('');
    }
  }

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.items || []).filter((model) => {
      if (source !== 'all' && model.source !== source) return false;
      if (!needle) return true;
      return `${model.id} ${model.displayName} ${model.aliases.join(' ')}`.toLowerCase().includes(needle);
    });
  }, [data, query, source]);

  const stats = useMemo(() => {
    const all = data?.items || [];
    return {
      total: all.length,
      robin: all.filter((model) => model.source === 'robin').length,
      aliases: all.reduce((sum, model) => sum + model.aliases.length, 0),
      disabled: all.filter((model) => !model.enabled).length
    };
  }, [data]);

  return (
    <>
      <PageHeader
        title="模型"
        description="从基座发现的模型、来源、上下文与别名；参数只影响新请求"
        actions={<>
          <button className="btn ghost" type="button" onClick={discover} disabled={Boolean(busy)}><RefreshIcon size={14} />{busy === 'discover' ? '发现中…' : '重新发现'}</button>
          <button className="btn" type="button" onClick={sync} disabled={Boolean(busy)}>{busy === 'sync' ? '同步中…' : '同步目录'}</button>
        </>}
      />

      {data?.stale ? <div className="notice bad">上游发现失败，正在显示上次目录。</div> : null}
      {error ? <div className="notice bad" style={{ marginBottom: 12 }}><AlertIcon size={16} /><span>{error}</span></div> : null}

      <div className="cards c4">
        <div className="card"><div className="stat-label">可用模型<BoxesIcon size={14} /></div><div className="stat-value">{stats.total}</div><div className="stat-hint">来自基座目录</div></div>
        <div className="card"><div className="stat-label">Gemini App</div><div className="stat-value">{stats.robin}</div><div className="stat-hint">Robin 独立来源</div></div>
        <div className="card"><div className="stat-label">别名</div><div className="stat-value">{stats.aliases}</div><div className="stat-hint">请求会按别名解析</div></div>
        <div className="card"><div className="stat-label">已停用</div><div className="stat-value">{stats.disabled}</div><div className="stat-hint">停用后从 /v1/models 隐藏</div></div>
      </div>

      <div className="log-filters" style={{ marginTop: 12 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <SearchIcon size={14} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--muted)' }} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型 ID、显示名或别名" style={{ width: '100%', paddingLeft: 32 }} />
        </div>
        <select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">全部来源</option><option value="cloudcode">Cloud Code</option><option value="robin">Gemini App</option></select>
        <button className="btn ghost small" onClick={() => void downloadCatalog('codex')}>Codex JSON</button><button className="btn ghost small" onClick={() => void downloadCatalog('claude')}>Claude JSON</button><span className="muted tiny">读取于 {data?.discoveredAt ? new Date(data.discoveredAt).toLocaleTimeString('zh-CN', { hour12: false }) : '—'}</span>
      </div>

      <div className="panel" style={{ padding: '8px 12px 4px' }}>
        {loading && !data ? <div className="skeleton" style={{ height: 220 }} /> : (
          <table className="table">
            <thead><tr><th>模型</th><th>来源</th><th>上下文</th><th>最大输出</th><th>别名</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {items.map((model) => (
                <tr key={model.id}>
                  <td><div className="strong">{model.displayName}</div><div className="muted tiny">{model.id}</div></td>
                  <td><span className={`badge ${model.source === 'robin' ? 'violet' : 'blue'}`}>{model.source === 'robin' ? 'Gemini App' : 'Cloud Code'}</span></td>
                  <td className="muted">{fmtContext(model.contextWindow)}</td>
                  <td className="muted">{fmtContext(model.maxOutputTokens)}</td>
                  <td className="muted tiny">{model.aliases.length ? model.aliases.join(', ') : '—'}</td>
                  <td>{model.enabled ? <span className="badge green">启用</span> : <span className="badge">已停用</span>}</td>
                  <td><button className="btn ghost small" type="button" disabled={Boolean(busy) || !model.enabled} onClick={() => void testModel(model.id)}>{busy === model.id ? '测试中…' : '测试'}</button><button className="btn ghost small" type="button" onClick={() => setEditing(model)}>编辑</button></td>
                </tr>
              ))}
              {!items.length ? <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 30 }}>没有匹配的模型</td></tr> : null}
            </tbody>
          </table>
        )}
      </div>
      <div className="footer"><span>上下文与输出上限优先使用管理设置，其次使用上游元数据</span><span>共 {items.length} 个模型</span></div>

      {editing ? <EditModelDialog model={editing} onClose={() => setEditing(null)} onSaved={(message) => { notify(message); void load(); }} /> : null}
      {toast ? <div className={`toast${toast.error ? ' error' : ''}`} role="status">{toast.text}</div> : null}
    </>
  );
}

function EditModelDialog({ model, onClose, onSaved }: { model: ModelEntry; onClose: () => void; onSaved: (message: string) => void }) {
  const [displayName, setDisplayName] = useState(model.displayName);
  const [contextWindow, setContextWindow] = useState(model.contextWindow ? String(model.contextWindow) : '');
  const [maxOutputTokens, setMaxOutputTokens] = useState(model.maxOutputTokens ? String(model.maxOutputTokens) : '');
  const [temperature, setTemperature] = useState(model.defaultTemperature == null ? '' : String(model.defaultTemperature));
  const [maxTokens, setMaxTokens] = useState(model.defaultMaxTokens == null ? '' : String(model.defaultMaxTokens));
  const [aliases, setAliases] = useState(model.aliases.join('\n'));
  const [enabled, setEnabled] = useState(model.enabled);
  const [note, setNote] = useState(model.note || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api(`/models/${encodeURIComponent(model.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          displayName,
          contextWindow: contextWindow ? Number(contextWindow) : null,
          maxOutputTokens: maxOutputTokens ? Number(maxOutputTokens) : null,
          defaultTemperature: temperature === '' ? null : Number(temperature),
          defaultMaxTokens: maxTokens === '' ? null : Number(maxTokens),
          aliases: aliases.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
          enabled,
          note
        })
      });
      onSaved('模型设置已保存');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="编辑模型" description={model.id} onClose={onClose} footer={<>
      <button className="btn ghost" type="button" onClick={onClose}>取消</button>
      <button className="btn" type="button" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
    </>}>
      <div className="form-grid">
        <div className="form-row">
          <div className="field"><label htmlFor="model-name">显示名</label><input id="model-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={100} /></div>
          <div className="switch-row"><span>启用</span><button className={`switch${enabled ? ' on' : ''}`} type="button" role="switch" aria-checked={enabled} onClick={() => setEnabled(!enabled)} /></div>
        </div>
        <div className="form-row">
          <div className="field"><label htmlFor="model-context">上下文窗口（Token）</label><input id="model-context" type="number" min={1024} value={contextWindow} onChange={(event) => setContextWindow(event.target.value)} /></div>
          <div className="field"><label htmlFor="model-output">最大输出（Token）</label><input id="model-output" type="number" min={1} value={maxOutputTokens} onChange={(event) => setMaxOutputTokens(event.target.value)} /></div>
        </div>
        <div className="form-row"><div className="field"><label htmlFor="model-temperature">默认 temperature（空为上游默认）</label><input id="model-temperature" type="number" min={0} max={2} step={0.1} value={temperature} onChange={e => setTemperature(e.target.value)} /></div><div className="field"><label htmlFor="model-max-tokens">默认 max_tokens</label><input id="model-max-tokens" type="number" min={1} max={1000000} value={maxTokens} onChange={e => setMaxTokens(e.target.value)} /></div></div><div className="field"><label htmlFor="model-aliases">别名（逗号或换行，请求时按别名解析）</label><textarea id="model-aliases" value={aliases} onChange={(event) => setAliases(event.target.value)} /></div>
        <div className="field"><label htmlFor="model-note">备注</label><input id="model-note" value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} /></div>
        {error ? <div className="login-error">{error}</div> : null}
      </div>
    </Modal>
  );
}
