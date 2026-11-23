export function isErrorAccountState(state: string): boolean {
  return state !== 'available' && state !== 'cooldown' && state !== 'disabled';
}

export function matchesAccountStateFilter(state: string, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'error') return isErrorAccountState(state);
  return state === filter;
}

export function accountStateLabel(state: string): string {
  if (state === 'available') return '可用';
  if (state === 'cooldown') return '冷却';
  if (state === 'disabled') return '已暂停';
  if (state === 'verification_required') return '需核验';
  if (state === 'authentication_error') return '凭据失效';
  if (state === 'access_denied') return '访问受限';
  return '异常';
}

export function applyAccountEnabledPatch<T extends { id: string; enabled: boolean; state: string }>(
  items: T[],
  id: string,
  enabled: boolean
): T[] {
  return items.map((item) => {
    if (item.id !== id) return item;
    const nextState = !enabled
      ? 'disabled'
      : item.state === 'disabled'
        ? 'available'
        : item.state;
    return { ...item, enabled, state: nextState };
  });
}

export function calculateCacheHitRate(inputTokens?: number | null, cachedTokens?: number | null): number | null {
  const input = Number(inputTokens) || 0;
  const cached = Number(cachedTokens) || 0;
  if (input <= 0) return null;
  return Math.min(100, Math.max(0, (cached / input) * 100));
}
