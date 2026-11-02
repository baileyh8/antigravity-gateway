'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function invalid(message) {
  return Object.assign(new Error(message), { status: 400, code: 'invalid_model_setting' });
}

class ModelSettings {
  constructor({ configDir, fsImpl = fs } = {}) {
    this.file = path.join(configDir, 'models.json');
    this.fs = fsImpl;
    this.state = this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
      return {
        version: 1,
        aliases: parsed?.aliases && typeof parsed.aliases === 'object' ? parsed.aliases : {},
        models: parsed?.models && typeof parsed.models === 'object' ? parsed.models : {}
      };
    } catch {
      return { version: 1, aliases: {}, models: {} };
    }
  }

  save() {
    this.fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      this.fs.writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
      this.fs.renameSync(temporary, this.file);
      this.fs.chmodSync(this.file, 0o600);
    } finally {
      try { this.fs.rmSync(temporary, { force: true }); } catch { /* retain original error */ }
    }
  }

  aliases() {
    return { ...this.state.aliases };
  }

  get(id) {
    return this.state.models[id] || {};
  }

  isDisabled(id) {
    return this.state.models[id]?.enabled === false;
  }

  update(id, patch = {}) {
    const modelId = String(id || '').trim();
    if (!modelId) throw invalid('模型 ID 不能为空。');
    const current = { ...(this.state.models[modelId] || {}) };
    if (patch.displayName !== undefined) current.displayName = String(patch.displayName || '').trim().slice(0, 100);
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== 'boolean') throw invalid('启用状态必须为布尔值。');
      current.enabled = patch.enabled;
    }
    for (const [field, min, max] of [['defaultTemperature', 0, 2], ['defaultMaxTokens', 1, 1000000]]) {
      if (patch[field] === undefined) continue;
      if (patch[field] === null || patch[field] === '') { delete current[field]; continue; }
      const value = Number(patch[field]);
      if (!Number.isFinite(value) || value < min || value > max) throw invalid(`${field} 必须在 ${min}–${max} 之间。`);
      current[field] = field === 'defaultMaxTokens' ? Math.floor(value) : value;
    }
    if (patch.contextWindow !== undefined) {
      const value = patch.contextWindow === null ? null : Number(patch.contextWindow);
      if (value !== null && (!Number.isFinite(value) || value < 1024 || value > 10_000_000)) throw invalid('上下文窗口必须在 1K-10M 之间。');
      if (value === null) delete current.contextWindow; else current.contextWindow = Math.floor(value);
    }
    if (patch.maxOutputTokens !== undefined) {
      const value = patch.maxOutputTokens === null ? null : Number(patch.maxOutputTokens);
      if (value !== null && (!Number.isFinite(value) || value < 1 || value > 1_000_000)) throw invalid('最大输出必须在 1-1M 之间。');
      if (value === null) delete current.maxOutputTokens; else current.maxOutputTokens = Math.floor(value);
    }
    if (patch.note !== undefined) current.note = String(patch.note || '').slice(0, 200);
    if (patch.aliases !== undefined) {
      const aliases = Array.isArray(patch.aliases) ? patch.aliases.map((item) => String(item || '').trim()).filter(Boolean) : [];
      if (aliases.length > 20) throw invalid('每个模型最多 20 个别名。');
      current.aliases = [...new Set(aliases)];
    }
    const nextModels = { ...this.state.models, [modelId]: current };
    const nextAliases = {};
    for (const [model, value] of Object.entries(nextModels)) {
      for (const alias of Array.isArray(value.aliases) ? value.aliases : []) {
        if (alias === model || Object.hasOwn(nextModels, alias)) throw invalid('别名不能覆盖模型 ID。');
        if (alias.length > 150 || !/^[a-zA-Z0-9._/-]+$/.test(alias) || ['__proto__', 'constructor', 'prototype'].includes(alias)) throw invalid('别名包含无效字符。');
        if (nextAliases[alias] && nextAliases[alias] !== model) throw invalid(`别名重复：${alias}`);
        nextAliases[alias] = model;
      }
    }
    const previous = this.state;
    this.state = { version: 1, models: nextModels, aliases: nextAliases };
    try { this.save(); } catch (error) { this.state = previous; throw error; }
    return { id: modelId, ...current };
  }
}

module.exports = { ModelSettings };
