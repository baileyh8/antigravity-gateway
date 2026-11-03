'use strict';

const { affinityActive, modelGroup, SESSION_CAPACITY, AFFINITY_MAX_TURNS } = require('./account-scheduling');
const GROUPS = ['gemini', 'claude-gpt', 'argon', 'unknown', 'gemini-robin'];
const groupKey = (model, provider) => provider === 'robin' ? 'gemini-robin' : modelGroup(model);
const turns = value => Number.isSafeInteger(value) && value > 0 ? Math.min(value, AFFINITY_MAX_TURNS) : 0;

function cleanBinding(value) {
  if (!value?.accountId || !Number.isFinite(value.at)) return null;
  return { accountId: String(value.accountId), at: value.at, turns: turns(value.turns) };
}

// Old files contain only accountId/at. Keep that account as a seed for a group
// without a binding; never inherit another group's successful-request count.
function normalizeAffinity(value) {
  const root = cleanBinding(value);
  if (!root) return null;
  if (value.groups) {
    root.groups = {};
    for (const group of GROUPS) {
      const binding = cleanBinding(value.groups[group]);
      if (binding) root.groups[group] = binding;
    }
  }
  return root;
}

function affinityBinding(root, model, provider = '') {
  if (!root) return null;
  return root.groups?.[groupKey(model, provider)]
    || (root.groups ? { accountId: root.accountId, at: root.at, turns: 0 } : root);
}

function withinAffinity(binding, now, limit) {
  return affinityActive(binding, now) && turns(binding.turns) + (binding.pending || 0) < limit;
}

function mirror(root, binding) {
  root.accountId = binding.accountId;
  root.at = binding.at;
  root.turns = binding.turns;
}

// Called synchronously inside admission's selection callback. Pending requests
// reserve budget before the next request can select an account. Only success
// commits a turn. Late completions cannot rebind a group that has already moved.
function reserveAffinity(sessions, key, accountId, model, provider, now, limit, changed, { retainOwner = false } = {}) {
  if (!key) return () => {};
  let root = sessions.get(key);
  const previous = affinityBinding(root, model, provider);
  if (!root) root = { accountId, at: now, turns: 0 };
  if (!root.groups) root.groups = {};
  const group = groupKey(model, provider);
  let binding = root.groups[group];
  // A child may already have moved the shared affinity while this native task
  // still belongs to its original account. Finishing it must not move back.
  if (retainOwner && binding && binding.accountId !== accountId) return () => {};
  if (!binding && previous?.accountId === accountId && affinityActive(previous, now)) {
    binding = { accountId, at: previous.at, turns: turns(previous.turns), pending: 0 };
  }
  if (!binding || binding.accountId !== accountId || !retainOwner && !withinAffinity(binding, now, limit)) {
    binding = { accountId, at: now, turns: 0, pending: 0 };
  }
  binding.pending = (binding.pending || 0) + 1;
  root.groups[group] = binding;
  mirror(root, binding);
  sessions.set(key, root);
  while (sessions.size > SESSION_CAPACITY) sessions.delete(sessions.keys().next().value);
  let finished = false;
  return success => {
    if (finished) return;
    finished = true;
    binding.pending--;
    if (success) binding.turns = Math.min(AFFINITY_MAX_TURNS, turns(binding.turns) + 1);
    if (sessions.get(key) !== root || root.groups[group] !== binding) return;
    if (root.accountId === binding.accountId && root.at === binding.at) mirror(root, binding);
    // Failed attempts do not add turns, including requests aborted in flight.
    if (success) changed();
  };
}

function deleteAffinity(sessions, key, model, provider = '', expectedAccountId = '') {
  const root = sessions.get(key);
  if (!root) return false;
  if (model == null) return sessions.delete(key);
  const group = groupKey(model, provider), binding = affinityBinding(root, model, provider);
  if (expectedAccountId && binding?.accountId !== expectedAccountId) return false;
  if (!root.groups) return sessions.delete(key);
  if (!root.groups[group]) return false;
  delete root.groups[group];
  const remaining = Object.values(root.groups);
  if (!remaining.length) return sessions.delete(key);
  mirror(root, remaining[remaining.length - 1]);
  return true;
}

function pruneAffinities(sessions, entries, now) {
  let changed = false;
  for (const [key, root] of sessions) {
    if (!root.groups) {
      if (!affinityActive(root, now) || !entries.has(root.accountId)) { sessions.delete(key); changed = true; }
      continue;
    }
    for (const [group, binding] of Object.entries(root.groups)) {
      if (!binding.pending && (!affinityActive(binding, now) || !entries.has(binding.accountId))) {
        delete root.groups[group]; changed = true;
      }
    }
    const remaining = Object.values(root.groups);
    if (!remaining.length) { sessions.delete(key); changed = true; }
    else if (!remaining.some(binding => binding.accountId === root.accountId && binding.at === root.at)) mirror(root, remaining[remaining.length - 1]);
  }
  while (sessions.size > SESSION_CAPACITY) { sessions.delete(sessions.keys().next().value); changed = true; }
  return changed;
}

module.exports = { normalizeAffinity, affinityBinding, withinAffinity, reserveAffinity, deleteAffinity, pruneAffinities };
