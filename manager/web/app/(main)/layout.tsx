'use client';

import { useEffect } from 'react';
import { Shell } from '@/components/shell';
import { useAuth } from '@/lib/auth';
import { BASE_PATH } from '@/lib/base-path';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();

  useEffect(() => {
    if (!loading && !me) window.location.replace(`${BASE_PATH}/login/`);
  }, [loading, me]);

  if (loading) {
    return (
      <div className="wrap">
        <div className="skeleton" style={{ height: 120, marginTop: 40 }} />
      </div>
    );
  }
  if (!me) return null;
  return <Shell>{children}</Shell>;
}
