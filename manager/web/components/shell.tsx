'use client';

import { useAuth } from '@/lib/auth';
import { BASE_PATH } from '@/lib/base-path';
import { Dock } from './dock';
import { LogOutIcon } from './icons';

export function Shell({ children }: { children: React.ReactNode }) {
  const { me, logout } = useAuth();

  async function handleLogout() {
    await logout();
    window.location.replace(`${BASE_PATH}/login/`);
  }

  return (
    <>
      <div className="wrap">
        <div className="user-menu" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
          <span>{me?.username || ''}</span>
          {me?.role ? <span className="badge">{me.role === 'admin' ? '管理员' : '只读'}</span> : null}
          <button className="btn ghost" type="button" onClick={handleLogout}>
            <LogOutIcon size={14} />退出
          </button>
        </div>
        {children}
      </div>
      <Dock />
    </>
  );
}
