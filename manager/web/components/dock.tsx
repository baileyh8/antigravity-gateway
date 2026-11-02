'use client';

import { usePathname } from 'next/navigation';
import { BASE_PATH } from '@/lib/base-path';
import {
  BoxesIcon,
  ChartIcon,
  GearIcon,
  KeyIcon,
  ScrollIcon,
  TrendIcon,
  UsersIcon
} from './icons';

const ITEMS = [
  { href: '/dashboard/', label: '看板', icon: ChartIcon, enabled: true },
  { href: '/accounts/', label: '账号', icon: UsersIcon, enabled: true },
  { href: '/keys/', label: '密钥', icon: KeyIcon, enabled: true },
  { href: '/models/', label: '模型', icon: BoxesIcon, enabled: true },
  { href: '/usage/', label: '用量', icon: TrendIcon, enabled: true },
  { href: '/logs/', label: '日志', icon: ScrollIcon, enabled: true },
  { href: '/settings/', label: '设置', icon: GearIcon, enabled: true },
];

export function Dock() {
  const pathname = usePathname() || '/';
  const path = BASE_PATH && pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) : pathname;

  return (
    <nav className="dock" aria-label="主导航">
      {ITEMS.map((item, index) => {
        const Icon = item.icon;
        const active = path === item.href || path.startsWith(item.href);
        const separator = index === 4 || index === 6;
        return (
          <span key={item.href} style={{ display: 'contents' }}>
            {separator ? <span className="sep" /> : null}
            {item.enabled ? (
              <a className={active ? 'on' : ''} href={`${BASE_PATH}${item.href}`} aria-current={active ? 'page' : undefined}>
                <Icon />
                <em>{item.label}</em>
              </a>
            ) : (
              <button type="button" className="disabled" disabled title={item.label}>
                <Icon />
                <em>{item.label}</em>
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
