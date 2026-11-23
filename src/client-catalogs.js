'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveModelConfiguration } = require('./antigravity-model-config');

// The Argon family is served by the Cloud Code pool since the Robin and
// Gemini Windows channels were removed; only the bare slug ever routed there.
const ARGON_MODEL = 'gemini-4-argon';

// Published Gemini API specifications, not a measured transport limit.
// Input and output share the window; long-decode API mode is not advertised.
const ARGON_MODEL_METADATA = Object.freeze({
  context_window: 1048576,
  max_output_tokens: 65536,
  input_modalities: ['text', 'image', 'video', 'audio', 'pdf'],
  output_modalities: ['text'],
  supports_function_calling: true,
  metadata_source: 'https://ai.google.dev/gemini-api/docs/models/gemini-4-argon',
  metadata_scope: 'published_gemini_api_specification',
  context_window_shared: true,
  gateway_transport: 'cloudcode_default_model',
  gateway_limits_verified: false,
  video_route: 'cloudcode_default_model'
});

// Presentation order only. Request routing always uses the untouched model ID
// supplied by the client and never depends on this list.
const MODEL_DISPLAY_PRIORITY = [
  'gemini-3.8-flash-high',
  'gemini-3.7-flash-high',
  'claude-opus-4-6-thinking',
  'claude-sonnet-4-6',
  'gemini-3.1-pro-high',
  'gemini-3.1-flash-image',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-low',
  'gemini-3.8-flash-tiered',
  'gemini-3.7-flash-medium',
  'gemini-3.7-flash-low',
  'gemini-3.7-flash',
  'gemini-3.7-flash-tiered',
  'gemini-3.5-flash-extra-low',
  'gemini-3.1-pro-low',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-agent',
  'gemini-3-flash',
  'gemini-2.5-pro',
  'gemini-2.5-flash-thinking',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-pro-agent'
];

const MODEL_DISPLAY_RANK = new Map(MODEL_DISPLAY_PRIORITY.map((model, index) => [model, index]));

function displayModels(models) {
  return [...models].sort((left, right) => {
    const leftRank = MODEL_DISPLAY_RANK.get(left);
    const rightRank = MODEL_DISPLAY_RANK.get(right);
    if (leftRank !== undefined || rightRank !== undefined) {
      if (leftRank === undefined) return 1;
      if (rightRank === undefined) return -1;
      return leftRank - rightRank;
    }
    const leftKey = left.toLowerCase();
    const rightKey = right.toLowerCase();
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function featuredModels(models) {
  return displayModels(models).filter((model) => (
    /^gemini-3\.[78](?:[.-]|$)/i.test(model)
    || model === 'claude-opus-4-6-thinking'
    || model === 'claude-sonnet-4-6'
    || model === ARGON_MODEL
  ));
}

function preferredFastModel(models, { fastModel = '', defaultModel = 'gemini-3.8-flash-high' } = {}) {
  if (fastModel) return fastModel;
  const priorities = [
    /^gemini-3\.8-flash-low$/i,
    /^gemini-3\.7-flash-low$/i,
    /^gemini-3\.6-flash-low$/i,
    /^gemini-3\.5-flash-(?:extra-)?low$/i,
    /flash-lite/i,
    /-flash-low$/i,
    /-low$/i,
    /-flash$/i
  ];
  for (const pattern of priorities) {
    const match = models.find((model) => pattern.test(model));
    if (match) return match;
  }
  return defaultModel;
}

function createCatalogHelpers({ configDir, version, usesDirectTransport, accountPool, modelSettings }) {
  function codexModelInfo(slug, priority) {
    const argon = slug === ARGON_MODEL;
    const tieredArgon = /^gemini-4-argon-(?:low|medium|high)$/.test(slug);
    const upstream = usesDirectTransport() ? accountPool.modelInfo(slug) : null;
    const resolved = resolveModelConfiguration(slug, upstream);
    const mimeTypes = resolved.profile.supportedMimeTypes && typeof resolved.profile.supportedMimeTypes === 'object'
      && !Array.isArray(resolved.profile.supportedMimeTypes) ? structuredClone(resolved.profile.supportedMimeTypes) : {};
    const mediaCapability = (field, prefix) => typeof resolved.profile[field] === 'boolean' ? resolved.profile[field]
      : Object.entries(mimeTypes).some(([type, supported]) => supported === true && type.toLowerCase().startsWith(prefix + '/'));
    const supportsImages = argon || mediaCapability('supportsImages', 'image');
    const thinking = argon ? null : resolved.thinkingConfig;
    // Preserve our captured numeric Hydrogen XHigh enum; upstream's generic
    // fixed-tier catalog handles strings, while this fork also supports 100.
    const effort = thinking?.thinkingLevel === 100 ? 'xhigh'
      : typeof thinking?.thinkingLevel === 'string' ? thinking.thinkingLevel.toLowerCase() : null;
    const setting = modelSettings.get(slug);
    // Cloud Code currently reports 1,048,576 input tokens for Gemini 3.7/3.8
    // Flash. Keep that verified fallback even when a transient discovery request
    // fails; otherwise the client would compact a healthy 1M context at 200K.
    const contextWindow = setting.contextWindow || (argon ? ARGON_MODEL_METADATA.context_window : upstream?.maxTokens)
      || (tieredArgon ? resolved.profile.maxTokens : null)
      || (/^gemini-3\.[78]-flash(?:[.-]|$)/i.test(slug) ? 1048576 : 200000);
    return {
      slug,
      display_name: setting.displayName || upstream?.displayName || slug,
      description: 'Model provided through the local Antigravity Gateway.',
      prefer_websockets: false,
      support_verbosity: false,
      default_verbosity: 'low',
      apply_patch_tool_type: 'freeform',
      web_search_tool_type: 'text_and_image',
      upstream_provider: 'cloudcode',
      upstream_protocol: 'Google Antigravity API',
      input_modalities: argon ? ARGON_MODEL_METADATA.input_modalities : supportsImages ? ['text', 'image'] : ['text'],
      supports_images: supportsImages,
      supports_video: argon || mediaCapability('supportsVideo', 'video'),
      supports_audio: argon || mediaCapability('supportsAudio', 'audio'),
      supported_mime_types: mimeTypes,
      supports_image_detail_original: supportsImages && resolved.profile.supportsImageDetailOriginal === true,
      truncation_policy: { mode: 'tokens', limit: 10000 },
      supports_parallel_tool_calls: true,
      tool_mode: 'direct',
      multi_agent_version: 'v1',
      use_responses_lite: false,
      include_skills_usage_instructions: true,
      include_plugin_usage_instructions: true,
      include_apps_usage_instructions: true,
      auto_review_model_override: null,
      context_window: contextWindow,
      max_context_window: contextWindow,
      max_output_tokens: argon ? ARGON_MODEL_METADATA.max_output_tokens
        : (tieredArgon ? resolved.profile.maxOutputTokens : upstream?.maxOutputTokens) || null,
      ...(argon ? ARGON_MODEL_METADATA : {}),
      ...(setting.contextWindow ? { context_window: setting.contextWindow, max_context_window: setting.contextWindow } : {}),
      ...(setting.maxOutputTokens ? { max_output_tokens: setting.maxOutputTokens } : {}),
      auto_compact_token_limit: null,
      comp_hash: `antigravity-gateway-${version}`,
      base_instructions: 'Follow the client instructions and use only client-provided tools when needed.',
      reasoning_summary_format: 'experimental',
      default_reasoning_summary: 'none',
      default_reasoning_level: effort,
      supported_reasoning_levels: resolved.supportedReasoningLevels
        ? resolved.supportedReasoningLevels.map(level => ({ effort: level, description: `Selectable reasoning level: ${level}` }))
        : effort ? [{ effort, description: `Fixed by model: ${slug}` }] : [],
      ...(thinking ? { [resolved.supportedReasoningLevels ? 'default_thinking_config' : 'fixed_thinking_config']: structuredClone(thinking) } : {}),
      shell_type: 'shell_command',
      visibility: 'list',
      minimal_client_version: '0.0.0',
      supported_in_api: true,
      availability_nux: null,
      upgrade: null,
      priority,
      model_messages: null,
      experimental_supported_tools: [],
      available_in_plans: [],
      supports_search_tool: false,
      default_service_tier: null,
      service_tiers: [],
      additional_speed_tiers: [],
      supports_reasoning_summaries: false
    };
  }

  function codexCatalogPath() {
    return path.join(configDir, 'codex-models.json');
  }

  function claudeConfigPath() {
    return path.join(configDir, 'claude-models.json');
  }

  function codexCatalogBody(models) {
    const ordered = displayModels(models);
    const catalog = ordered.map((id, index) => codexModelInfo(id, index));
    return {
      object: 'list',
      data: catalog.map((model) => ({
        id: model.slug, object: 'model', created: 0, owned_by: 'antigravity', display_name: model.display_name,
        ...(model.slug === ARGON_MODEL ? ARGON_MODEL_METADATA : {}),
        upstream_provider: model.upstream_provider, upstream_protocol: model.upstream_protocol,
        context_window: model.context_window, max_output_tokens: model.max_output_tokens,
        input_modalities: model.input_modalities, supports_images: model.supports_images,
        supports_video: model.supports_video, supports_audio: model.supports_audio,
        supported_mime_types: structuredClone(model.supported_mime_types),
        default_reasoning_level: model.default_reasoning_level, supported_reasoning_levels: model.supported_reasoning_levels,
        ...(model.fixed_thinking_config ? { fixed_thinking_config: structuredClone(model.fixed_thinking_config) } : {}),
        ...(model.default_thinking_config ? { default_thinking_config: structuredClone(model.default_thinking_config) } : {})
      })),
      models: catalog
    };
  }

  function writeCodexCatalog(models) {
    const target = codexCatalogPath();
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(codexCatalogBody(models), null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, target);
    return target;
  }

  function claudeConfigBody(models) {
    const ordered = displayModels(models);
    return {
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      modelPicker: {
        options: ordered.map((model) => ({
          model,
          label: model,
          description: 'Antigravity Gateway'
        })),
        replaceBuiltInOptions: true
      }
    };
  }

  function writeClaudeConfig(models) {
    const target = claudeConfigPath();
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(claudeConfigBody(models), null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, target);
    return target;
  }

  return {
    codexModelInfo,
    codexCatalogPath,
    claudeConfigPath,
    codexCatalogBody,
    writeCodexCatalog,
    claudeConfigBody,
    writeClaudeConfig
  };
}

module.exports = {
  ARGON_MODEL,
  ARGON_MODEL_METADATA,
  MODEL_DISPLAY_PRIORITY,
  createCatalogHelpers,
  displayModels,
  featuredModels,
  preferredFastModel
};
