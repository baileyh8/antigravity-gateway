'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Account, ProxySnapshot } from '@/lib/types';
import { Modal } from '@/components/modal';

export function EditAccountDialog({
  account,
  proxies,
  onClose,
  onSaved
}: {
  account: Account;
  proxies: ProxySnapshot | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const bindingKey = account.providerType === 'robin' ? `robin:${account.id}` : account.id;
  const [enabled, setEnabled] = useState(account.enabled);
  const [weight, setWeight] = useState(String(account.weight || 1));
  const [note, setNote] = useState(account.note || '');
  const [proxyId, setProxyId] = useState(proxies?.bindings?.[bindingKey] || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setError('');
    try {
      const value = Number(weight);
      if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error('权重必须是 1-100 的整数。');
      await api(`/accounts/${encodeURIComponent(account.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled, weight: value, note, provider: account.providerType })
      });
      const currentProxy = proxies?.bindings?.[bindingKey] || '';
      if ((proxyId || '') !== currentProxy) {
        await api(`/accounts/${encodeURIComponent(account.id)}/proxy`, {
          method: 'PUT',
          body: JSON.stringify({ proxyId: proxyId || null, provider: account.providerType })
        });
      }
      onSaved('账号设置已保存');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="编辑账号"
      description={account.emailMasked || account.id}
      onClose={onClose}
      footer={<>
        <button className="btn ghost" type="button" onClick={onClose}>取消</button>
        <button className="btn" type="button" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
      </>}
    >
      <div className="form-grid">
        <div className="switch-row">
          <span>参与调度</span>
          <button className={`switch${enabled ? ' on' : ''}`} type="button" role="switch" aria-checked={enabled} onClick={() => setEnabled(!enabled)} />
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="weight">权重（1-100）</label>
            <input id="weight" type="number" min={1} max={100} value={weight} onChange={(event) => setWeight(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="proxy">出口代理</label>
            <select id="proxy" value={proxyId} onChange={(event) => setProxyId(event.target.value)}>
              <option value="">默认出口</option>
              {(proxies?.proxies || []).map((proxy) => <option key={proxy.id} value={proxy.id}>{proxy.name} · {proxy.endpoint}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="note">备注（仅管理后台保存）</label>
          <textarea id="note" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="例如：日常主账号、夜间备用" />
        </div>
        {error ? <div className="login-error">{error}</div> : null}
      </div>
    </Modal>
  );
}
