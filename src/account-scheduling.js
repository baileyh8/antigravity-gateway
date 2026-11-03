'use strict';

// All transports share one policy; credentials, quota acquisition, health and
// active upstream task ownership remain the responsibility of each provider.
const DEFAULT_SESSION_TTL_SECONDS = 5 * 60 * 60;
const configuredSeconds = Number(process.env.ANTIGRAVITY_AFFINITY_TTL_SECONDS
  ?? process.env.ANTIGRAVITY_ROBIN_AFFINITY_TTL_SECONDS ?? DEFAULT_SESSION_TTL_SECONDS);
const SESSION_TTL_MS = Math.max(0, Number.isFinite(configuredSeconds)
  ? configuredSeconds : DEFAULT_SESSION_TTL_SECONDS) * 1000;
const SESSION_CAPACITY = 2000;
const QUOTA_TTL_MS = 30 * 60_000;
const QUOTA_RETRY_MS = 5 * 60_000;
const QUOTA_RESERVE_FRACTION = 0.05;
const QUOTA_FRACTION_EPSILON = 1e-7; // Native Float32 usage can encode 95% just below .95.
const ACTIVE_QUOTA_REFRESH_MS = 60_000;
const LOW_QUOTA_REFRESH_MS = 15_000;
const TRANSIENT_COOLDOWN_MS = 15_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 7 * 24 * 60 * 60_000;

function durationMs(value) {
  const source = String(value || '');
  let total = 0;
  let matched = false;
  for (const match of source.matchAll(/(\d+(?:\.\d+)?)(ms|[smhd])/gi)) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    total += amount * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] || 0);
  }
  return matched ? total : 0;
}

function retryDelay(details, fallback = DEFAULT_COOLDOWN_MS) {
  const source = String(details || '');
  const resetAt = source.match(/(?:quotaResetTimeStamp|resetTime|reset_at)[^0-9]{0,16}(\d{4}-\d{2}-\d{2}T[^"'\s,}]+)/i);
  if (resetAt) {
    const delay = Date.parse(resetAt[1]) - Date.now();
    if (Number.isFinite(delay) && delay > 0) return Math.max(1000, Math.min(MAX_COOLDOWN_MS, delay));
  }
  const duration = source.match(/(?:quotaResetDelay|retryDelay|retry_after|retry after|reset after)[^0-9]{0,24}((?:\d+(?:\.\d+)?(?:ms|[smhd]))+)/i);
  const milliseconds = durationMs(duration?.[1]);
  if (milliseconds > 0) return Math.max(1000, Math.min(MAX_COOLDOWN_MS, milliseconds));
  const seconds = source.match(/(?:retry_after|retry after)[^0-9]{0,8}(\d+(?:\.\d+)?)/i);
  return seconds ? Math.max(1000, Math.min(MAX_COOLDOWN_MS, Number(seconds[1]) * 1000)) : fallback;
}

function affinityActive(binding, now) {
  return Boolean(binding && SESSION_TTL_MS > 0 && binding.at >= now - SESSION_TTL_MS);
}

function modelGroup(model = '') {
  const id = String(model).replace(/^models\//, '').toLowerCase();
  if (id.includes('argon')) return 'argon';
  if (/^(claude|gpt|o[1-9](?:-|$))/.test(id)) return 'claude-gpt';
  if (!id || id.startsWith('gemini')) return 'gemini';
  return 'unknown';
}

function quotaGroup(snapshot, model = '', provider = '') {
  const groups = snapshot?.groups || [];
  // Gemini App GXU is the Argon quota for OAuth and Windows providers.
  if (provider === 'robin' || snapshot?.providerType === 'robin') {
    return groups.find(group => group.id === 'gemini-robin') || null;
  }
  const kind = modelGroup(model);
  return groups.find(group => {
    const label = `${group.id || ''} ${group.displayName || ''}`.toLowerCase();
    if (/argon/.test(label)) return kind === 'argon';
    if (/claude|gpt|(?:^|\s)3p(?:$|\s)/.test(label)) return kind === 'claude-gpt';
    return /gemini/.test(label) && kind === 'gemini';
  }) || null;
}

function activeBuckets(group, now) {
  return (group?.buckets || []).filter(bucket => {
    const remaining = bucket.remainingFraction;
    if (remaining == null || typeof remaining === 'boolean' || String(remaining).trim() === '' || !Number.isFinite(Number(remaining))) return false;
    const reset = Date.parse(bucket.resetTime);
    return !Number.isFinite(reset) || reset > now;
  });
}

function quotaReserveReached(snapshot, now, model = '', provider = '') {
  return activeBuckets(quotaGroup(snapshot, model, provider), now)
    .some(bucket => Number(bucket.remainingFraction) <= QUOTA_RESERVE_FRACTION + QUOTA_FRACTION_EPSILON || bucket.available === false);
}

function quotaRefreshInterval(snapshot, now, model = '', provider = '') {
  return activeBuckets(quotaGroup(snapshot, model, provider), now)
    .some(bucket => Number(bucket.remainingFraction) <= .2 + QUOTA_FRACTION_EPSILON) ? LOW_QUOTA_REFRESH_MS : ACTIVE_QUOTA_REFRESH_MS;
}

function boundedQuotaRefreshMs(value = QUOTA_RETRY_MS) {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? Math.max(LOW_QUOTA_REFRESH_MS, Math.min(QUOTA_RETRY_MS, milliseconds)) : QUOTA_RETRY_MS;
}

function weeklyPressure(group, now) {
  const bucket = (group?.buckets || []).find(item => String(item.window || '').toLowerCase() === 'weekly' || /-weekly$/i.test(item.id || ''));
  const raw = bucket?.remainingFraction;
  const remaining = raw == null || String(raw).trim() === '' || typeof raw === 'boolean' ? NaN : Number(raw);
  const resetAt = Date.parse(bucket?.resetTime || '');
  if (!Number.isFinite(remaining) || !Number.isFinite(resetAt) || resetAt <= now) return { kind: 'unknown', band: 0 };
  if (remaining <= 0 || bucket.available === false) return { kind: 'exhausted', band: 0 };
  const hours = Math.max((resetAt - now) / 3_600_000, 1 / 60);
  return { kind: 'pressure', band: Math.floor(Math.log2(Math.min(1, remaining) / hours)) };
}

function fiveHourResetTime(group, now) {
  const bucket = (group?.buckets || []).find(item => String(item.window || '').toLowerCase() === '5h');
  const resetTime = Date.parse(bucket?.resetTime || '');
  return Number.isFinite(resetTime) && resetTime > now ? resetTime : Infinity;
}

function geminiWeeklyPressure(snapshot, now) { return weeklyPressure(quotaGroup(snapshot), now); }
function geminiFiveHourResetTime(snapshot, now) { return fiveHourResetTime(quotaGroup(snapshot), now); }

function quotaRank(entry, snapshot, now, depleted = false, model = '', provider = '') {
  const group = quotaGroup(snapshot, model, provider);
  const buckets = activeBuckets(group, now);
  const weekly = weeklyPressure(group, now);
  const exhausted = buckets.some(bucket => Number(bucket.remainingFraction) <= 0 || bucket.available === false);
  return {
    entry, group: `${provider}:${modelGroup(model)}`, depleted: depleted || exhausted ? 1 : 0,
    reserveBlocked: quotaReserveReached(snapshot, now, model, provider),
    lane: exhausted ? 2 : { pressure: 0, unknown: 1, exhausted: 2 }[weekly.kind],
    band: weekly.band, resetTime: fiveHourResetTime(group, now)
  };
}

function compareQuotaRanks(left, right) {
  return left.depleted - right.depleted
    || left.lane - right.lane
    || right.band - left.band
    || (left.resetTime === right.resetTime ? 0 : left.resetTime < right.resetTime ? -1 : 1);
}

function weightedPickWithRanks(ranks, weights) {
  ranks = ranks.filter(rank => !rank.reserveBlocked);
  if (!ranks.length) return null;
  // Unknown telemetry retains its advisory lane. Known reserve readings are
  // excluded above and can never return through the last-resort fallback.
  let candidates = ranks.filter((rank) => !rank.depleted && rank.lane !== 2);
  if (!candidates.length) candidates = ranks.filter((rank) => !rank.depleted);
  if (!candidates.length) candidates = ranks;

  const pressureRanks = candidates.filter((rank) => rank.lane === 0);
  const maxBand = pressureRanks.length ? Math.max(...pressureRanks.map((rank) => rank.band)) : null;
  const nearestResetByBand = new Map();
  for (const rank of candidates) {
    if (!Number.isFinite(rank.resetTime)) continue;
    const key = `${rank.lane}:${rank.band}`;
    nearestResetByBand.set(key, Math.min(nearestResetByBand.get(key) ?? Infinity, rank.resetTime));
  }
  const effectiveWeight = (rank) => {
    const accountWeight = Math.max(1, Number(rank.entry.account.weight) || 1);
    let weeklyWeight = 1;
    if (rank.lane === 0 && maxBand != null) {
      const difference = rank.band - maxBand;
      weeklyWeight = difference >= 0 ? 4 : difference === -1 ? 2 : 1;
    }
    const nearestReset = nearestResetByBand.get(`${rank.lane}:${rank.band}`);
    const fiveHourWeight = Number.isFinite(nearestReset) && rank.resetTime === nearestReset ? 2 : 1;
    return accountWeight * weeklyWeight * fiveHourWeight;
  };
  const total = candidates.reduce((sum, rank) => sum + effectiveWeight(rank), 0);
  let selected = null;
  let selectedWeight = -Infinity;
  for (const rank of candidates) {
    const id = `${rank.group || 'gemini'}\0${rank.entry.account.id}`;
    const current = (weights.get(id) || 0) + effectiveWeight(rank);
    weights.set(id, current);
    if (current > selectedWeight) {
      selected = rank.entry;
      selectedWeight = current;
    }
  }
  if (selected) { const rank = candidates.find(item => item.entry === selected); const id = `${rank.group || 'gemini'}\0${selected.account.id}`; weights.set(id, (weights.get(id) || 0) - total); }
  return selected;
}

module.exports = {
  SESSION_TTL_MS, SESSION_CAPACITY, QUOTA_TTL_MS, QUOTA_RETRY_MS, TRANSIENT_COOLDOWN_MS,
  QUOTA_RESERVE_FRACTION, ACTIVE_QUOTA_REFRESH_MS, LOW_QUOTA_REFRESH_MS,
  quotaReserveReached, quotaRefreshInterval, boundedQuotaRefreshMs,
  durationMs, retryDelay, affinityActive,
  modelGroup, quotaGroup, geminiWeeklyPressure, geminiFiveHourResetTime, quotaRank, compareQuotaRanks, weightedPickWithRanks
};
