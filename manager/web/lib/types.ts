export type Counters = {
  clientRequests: number;
  upstreamCalls: number;
  successfulUpstreamCalls: number;
  failedUpstreamCalls: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cachedTokens: number;
  totalTokens: number;
};

export type QuotaBucket = {
  id: string;
  displayName: string;
  window: string;
  remainingFraction: number;
  resetTime: string;
  description: string;
  available: boolean;
};

export type QuotaGroup = {
  id: string;
  displayName: string;
  description: string;
  buckets: QuotaBucket[];
  available: boolean | null;
};

export type Quota = {
  groups?: QuotaGroup[];
  credits?: { creditAmount: number | null; minimumCreditAmountForUsage: number | null; available: boolean | null };
  updatedAt?: string;
  expiresAt?: string;
} | null;

export type Account = {
  id: string;
  emailMasked: string;
  providerType: string;
  accountType: string;
  enabled: boolean;
  state: string;
  weight: number;
  healthReason: string;
  healthMessage: string;
  cooldownUntil: string;
  lastSuccessAt: string;
  lastFailureAt: string;
  lastError: string;
  modelCooldowns: Array<{ model: string; until: string }>;
  quota: Quota;
  note?: string;
  noteUpdatedAt?: string;
};

export type TrendPoint = {
  date: string;
  requests: number;
  tokens: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
};

export type Overview = {
  version: string;
  startedAt: string;
  uptimeSeconds: number;
  transport: string;
  defaultModel: string;
  concurrency: {
    active: number;
    queued: number;
    limit: number;
    memory?: { body?: { used: number; limit: number } };
  };
  accounts: {
    total: number;
    available: number;
    cooldown: number;
    disabled: number;
    error: number;
    items: Account[];
  };
  usage: {
    today: Counters;
    last24h: Counters;
    lifetime: Counters;
  };
  trend: TrendPoint[];
  models: { count: number | null };
  keys: { active: number | null };
  generatedAt: string;
};

export type AccountsResponse = {
  items: Account[];
  counts: { total: number; available: number; cooldown: number; disabled: number; error: number };
  generatedAt: string;
};

export type ProxyEntry = {
  id: string;
  name: string;
  endpoint: string;
  authenticated: boolean;
  activeRequests: number;
  health: { ok: boolean; status?: number; checkedAt?: string; latencyMs?: number; error?: string } | null;
};

export type ProxySnapshot = {
  proxies: ProxyEntry[];
  bindings: Record<string, string>;
};

export type OAuthStatus = {
  id: string;
  provider: string;
  state: 'starting' | 'waiting' | 'checking' | 'complete' | 'failed' | 'cancelled' | 'idle';
  url: string;
  proxyId: string;
  account: { id: string; emailMasked: string } | null;
  error: string;
  startedAt: string;
};

export type KeyUsage = {
  requests: number;
  tokens: number;
  byModel: Record<string, number>;
  byDay: Record<string, { requests: number; tokens: number }>;
};

export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  enabled: boolean;
  createdAt: string;
  createdBy: string;
  expiresAt: string | null;
  models: string[];
  ipAllowlist: string[];
  quota: { tokens: number; requests: number };
  ratePerMin: number;
  note: string;
  lastUsedAt: string;
  usage: KeyUsage;
};

export type KeysResponse = { keys: ApiKey[]; multiKey: boolean };

export type RequestLogEntry = {
  accountLabel?: string;
  ts: number;
  id: string;
  key: string;
  keyName: string;
  model: string;
  upstreamModel: string;
  account: string;
  status: number;
  code: string;
  latencyMs: number;
  ttftMs: number | null;
  stream: boolean;
  input: number;
  output: number;
  cached: number;
  thinking: number;
  total: number;
  ip: string;
  ua: string;
  bytes: number;
};

export type DiagnosticEntry = {
  at: string;
  event: string;
  account?: string;
  accountId?: string;
  [key: string]: unknown;
};

export type AuditEntry = {
  ts: string;
  actor: string;
  ip: string;
  action: string;
  target: string;
  result: string;
  durationMs: number;
  detail: string;
};

export type LogPage<T> = { items: T[]; total: number; page: number; size: number; hasMore: boolean };

export type ModelEntry = {
  defaultTemperature?: number | null;
  defaultMaxTokens?: number | null;
  id: string;
  displayName: string;
  enabled: boolean;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  aliases: string[];
  note: string;
  source: 'cloudcode' | 'robin' | string;
};

export type ModelsResponse = {
  stale?: boolean;
  error?: string | null; items: ModelEntry[]; discoveredAt: string };
