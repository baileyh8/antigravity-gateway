'use client';

import { useEffect } from 'react';
import { BASE_PATH } from '@/lib/base-path';

export default function Home() {
  useEffect(() => {
    window.location.replace(`${BASE_PATH}/dashboard/`);
  }, []);
  return (
    <div className="login-shell">
      <div className="muted small">正在进入 agy-manager…</div>
    </div>
  );
}
