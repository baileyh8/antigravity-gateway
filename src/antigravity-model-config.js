'use strict';

// Google Antigravity API protocol: official 1.5.7 and 1.5.9 synthetic captures, 2026-11-13.
// These are exact discovered IDs, not inferred combinations of model suffixes.
const CAPTURED_MODELS = Object.freeze({
  ...require('./data/agy-1.5.7-models.json'),
  ...require('./data/agy-1.5.9-models.json'),
  'gemini-3.8-flash-high': Object.freeze({ model: 'MODEL_PLACEHOLDER_M318',
    displayName: 'Gemini 3.8 Flash (High)', maxOutputTokens: 65536, supportsThinking: true, thinkingLevel: 'HIGH' }),
  'gemini-3.8-flash-medium': Object.freeze({ model: 'MODEL_PLACEHOLDER_M319',
    displayName: 'Gemini 3.8 Flash (Medium)', maxOutputTokens: 65536, supportsThinking: true, thinkingLevel: 'MEDIUM' }),
  'gemini-3.8-flash-low': Object.freeze({ model: 'MODEL_PLACEHOLDER_M320',
    displayName: 'Gemini 3.8 Flash (Low)', maxOutputTokens: 65536, supportsThinking: true, thinkingLevel: 'LOW' }),
  'claude-sonnet-4-6': Object.freeze({ model: 'MODEL_PLACEHOLDER_M35',
    maxOutputTokens: 64000, supportsThinking: true, thinkingBudget: 1024 }),
  'claude-opus-4-6-thinking': Object.freeze({ model: 'MODEL_PLACEHOLDER_M26',
    maxOutputTokens: 64000, supportsThinking: true, thinkingBudget: 1024 }),
  'gpt-oss-120b-medium': Object.freeze({ model: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
    maxOutputTokens: 32768, supportsThinking: true, thinkingBudget: 8192 })
});

// Numeric directory values paired with actual generation captures.
const THINKING_LEVELS = Object.freeze({ 1: 'LOW', 2: 'MEDIUM', 3: 'HIGH' });
const SONAR_MODEL = 'gemini-4-hydrogen-sonar';
// Verified with isolated upstream generations; the directory reports the
// default LOW, not the complete set of accepted request levels.
const SONAR_REASONING_LEVELS = Object.freeze(['low', 'medium', 'high']);

function requestedReasoningLevel(normalized, model) {
  if (model !== SONAR_MODEL) return null;
  const effort = String(normalized?.reasoningEffort ?? '').trim().toLowerCase();
  // "none" retains the existing output-summary switch, not a new upstream
  // no-thinking capability. Omitted effort still uses the catalog default.
  if (!effort || effort === 'none') return null;
  const level = Object.hasOwn(THINKING_LEVELS, effort) ? THINKING_LEVELS[effort].toLowerCase() : effort;
  if (SONAR_REASONING_LEVELS.includes(level)) return level.toUpperCase();
  throw new ModelCapabilityError(model, {
    code: 'unsupported_thinking_level',
    message: 'Sonar 仅支持 low、medium、high（数字 1、2、3）；不支持 XHigh 或 MINIMAL。'
  });
}
function thinkingLevel(value) {
  if (value === 100) return 100; // Hydrogen XHigh: observed numeric protobuf JSON value.
  return (Object.hasOwn(THINKING_LEVELS, value) ? THINKING_LEVELS[value] : '')
    || (['LOW', 'MEDIUM', 'HIGH'].includes(value) ? value : '');
}

function capturedProfile(model) {
  return typeof model === 'string' && Object.hasOwn(CAPTURED_MODELS, model) ? CAPTURED_MODELS[model] : undefined;
}

function modelProfile(model, metadata) {
  const catalog = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  return { ...capturedProfile(model), ...catalog };
}

function profileThinking(profile) {
  if (!profile?.supportsThinking) return undefined;
  const level = thinkingLevel(profile.thinkingLevel);
  if (level) return { includeThoughts: true, thinkingLevel: level };
  if (Number.isFinite(profile.thinkingBudget)) {
    return { includeThoughts: true, thinkingBudget: profile.thinkingBudget };
  }
  return undefined;
}

function resolveModelConfiguration(model, metadata) {
  const profile = modelProfile(model, metadata);
  const captured = profileThinking(capturedProfile(model));
  // A known public name is a fixed contract even if a fresh directory reports
  // different defaults. Other directory fields (limits, labels) remain live.
  // Unknown names are only assigned thinking from their actual directory entry;
  // a suffix such as "-high" alone is not evidence of a supported configuration.
  const thinkingConfig = captured || profileThinking(profile);
  return {
    publicModel: model,
    upstreamModel: model,
    profile,
    thinkingConfig,
    ...(model === SONAR_MODEL ? { supportedReasoningLevels: SONAR_REASONING_LEVELS } : {}),
    thinkingSource: captured ? 'captured' : thinkingConfig ? 'catalog' : 'none'
  };
}

// Only generation-level controls are removed. Do not recurse into tools,
// messages, schemas, or a business argument that happens to share these names.
const CLIENT_THINKING_FIELDS = new Set([
  'thinking', 'thinkingConfig', 'thinking_config', 'thinkingLevel', 'thinkingBudget',
  'includeThoughts', 'reasoning', 'reasoning_effort', 'reasoningEffort',
  'include_reasoning', 'includeThinking', 'cachedContents', 'cachedContent', 'cached_contents', 'cached_content', 'cache_control', 'cacheControl'
]);
// Selectively ported from LeeFeee 2.1.3: a 64-token classifier budget can
// expire during fixed-tier thinking before producing the real closing tag.
const AUTO_MODE_MIN_OUTPUT_TOKENS = 4096;
function generationProfile(normalized = {}, model, metadata) {
  const resolved = resolveModelConfiguration(model, metadata);
  const requested = requestedReasoningLevel(normalized, model);
  const client = normalized?.generationConfig;
  const generation = {
    ...(resolved.profile.maxOutputTokens > 0 ? { maxOutputTokens: resolved.profile.maxOutputTokens } : {}),
    ...(client && typeof client === 'object' && !Array.isArray(client)
      ? Object.fromEntries(Object.entries(client).filter(([key]) => !CLIENT_THINKING_FIELDS.has(key))) : {})
  };
  // A client may advertise a larger window than this account's live output
  // capability. Respect the output ceiling without changing reasoning tier.
  const outputLimit = resolved.profile.maxOutputTokens;
  if (Number.isSafeInteger(outputLimit) && outputLimit > 0 && generation.maxOutputTokens > outputLimit) {
    generation.maxOutputTokens = outputLimit;
  }
  // Google removes matched stop sequences from its response. Let an identified
  // classifier generate its actual closing tag so strict XML validation can
  // check the complete verdict; never reconstruct a missing verdict or tag.
  const classifierClosingTag = normalized.autoMode && (normalized.autoModeFormat === 'severity'
    ? '</severity>' : normalized.autoModeFormat === 'block' ? '</block>' : null);
  if (classifierClosingTag && Array.isArray(generation.stopSequences)
    && generation.stopSequences.includes(classifierClosingTag)) {
    generation.stopSequences = generation.stopSequences.filter(stop => stop !== classifierClosingTag);
    if (!generation.stopSequences.length) delete generation.stopSequences;
  }
  const thinking = requested ? { includeThoughts: true, thinkingLevel: requested } : resolved.thinkingConfig;
  if (thinking) generation.thinkingConfig = thinking;
  if (classifierClosingTag && (thinking?.thinkingLevel || thinking?.thinkingBudget > 0 || thinking?.thinkingBudget === -1)
    && Number.isFinite(generation.maxOutputTokens) && generation.maxOutputTokens > 0) {
    const budget = Math.max(0, thinking.thinkingBudget || 0);
    const limit = resolved.profile.maxOutputTokens > 0 ? resolved.profile.maxOutputTokens : Infinity;
    generation.maxOutputTokens = Math.min(limit, Math.max(AUTO_MODE_MIN_OUTPUT_TOKENS, generation.maxOutputTokens + budget));
  }
  return Object.keys(generation).length ? generation : null;
}

// Proven by actual forced-tool requests; do not infer a restriction for every
// future model containing "claude" in its name.
const NO_THINKING_WITH_FORCED_TOOLS = new Set(['claude-sonnet-4-6', 'claude-opus-4-6-thinking']);
// Fresh official high/medium/low switch captures preserve previous text and
// tool-call signatures in both directions. Do not infer compatibility from a
// broad "gemini-*" prefix, a provider name or an unobserved model alias.
const SHARED_HISTORY_GROUPS = Object.freeze([
  Object.freeze(new Set(['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low']))
]);
const TOOL_SIGNATURE_MODEL_RE = /^gemini-(?:3(?:[.-]|$)|4-(?:hydrogen|carbon|neon)(?:[.-]|$)|4-argon(?:-(?:low|medium|high))?$)/i;

function compatibleHistoryModels(source, target) {
  if (typeof source !== 'string' || !source.length || typeof target !== 'string' || !target.length) return false;
  return source === target || SHARED_HISTORY_GROUPS.some(group => group.has(source) && group.has(target));
}

function requiresToolSignature(model) {
  return TOOL_SIGNATURE_MODEL_RE.test(String(model || ''));
}

function hasActiveThinking(thinkingConfig) {
  return Boolean(thinkingConfig && (thinkingConfig.thinkingLevel || thinkingConfig.thinkingBudget > 0 || thinkingConfig.thinkingBudget === -1));
}

class ModelCapabilityError extends Error {
  constructor(model, { code = 'model_capability_conflict', message } = {}) {
    super(message || `模型 ${model} 的固定思考配置不支持强制工具调用。请使用自动工具选择，或选择支持该组合的模型。`);
    this.name = 'ModelCapabilityError';
    this.code = code;
    this.status = 400;
  }
}

function assertGenerationCompatibility(model, generationConfig, toolMode) {
  if (toolMode === 'ANY' && generationConfig?.thinkingConfig && NO_THINKING_WITH_FORCED_TOOLS.has(model)) {
    throw new ModelCapabilityError(model);
  }
}

module.exports = { CAPTURED_MODELS, thinkingLevel, modelProfile, resolveModelConfiguration, requestedReasoningLevel,
  generationProfile, assertGenerationCompatibility, compatibleHistoryModels, requiresToolSignature, hasActiveThinking, ModelCapabilityError };
