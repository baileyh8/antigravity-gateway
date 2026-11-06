'use strict';

// Candidate collection is done by the caller; this module only decides which
// candidates may become mappings. Two rules matter:
//
//   1. A mapping must be provably reversible before it is created. The captured
//      profiles were verified against real captures, so they are exempt; the
//      semantic layer infers, so it must pass a bijection check.
//   2. A contested native name is never resolved by picking a winner. If two
//      declarations would become the same native tool, both are dropped: any
//      choice would be a guess, and a wrong guess rewrites the wrong tool.

// True when translating this declaration forward and back returns exactly the
// submitted parameter set. A partial map would silently drop or rename a field
// on the way back, so any mismatch disqualifies the candidate.
function isBijective(tool, rule) {
  const parameters = rule && rule.parameters;
  if (!parameters || typeof parameters !== 'object') return false;
  const declared = Object.keys(tool?.schema?.properties || {});
  if (!declared.length) return false;
  const mapped = Object.keys(parameters);
  if (mapped.length !== declared.length) return false;
  if (!mapped.every(name => Object.hasOwn(tool.schema.properties, name))) return false;
  const targets = Object.values(parameters);
  if (new Set(targets).size !== targets.length) return false;
  const required = tool.schema.required || [];
  if (!required.every(name => Object.hasOwn(parameters, name))) return false;
  return true;
}

// `candidates` entries are `{ tool, rule, layer }` where layer is 'profile' or
// 'semantic'. `takenNames` is every tool name the client already declared: a
// mapping must never shadow one of those, because the client owns that name.
function arbitrate(candidates, takenNames) {
  const groups = new Map();
  for (const candidate of candidates) {
    const native = candidate.rule?.name;
    if (!native) continue;
    if (!groups.has(native)) groups.set(native, []);
    groups.get(native).push(candidate);
  }
  const mappings = new Map(), source = new Map(), declined = [];
  for (const [native, list] of groups) {
    if (takenNames.has(native)) { declined.push({ native, reason: 'client_declares_native_name' }); continue; }
    if (list.length > 1) { declined.push({ native, reason: 'contested_by_multiple_declarations' }); continue; }
    const candidate = list[0];
    if (candidate.layer === 'semantic' && !isBijective(candidate.tool, candidate.rule)) {
      declined.push({ native, reason: 'not_reversible' });
      continue;
    }
    mappings.set(candidate.tool.name, candidate.rule);
    source.set(native, candidate.tool);
  }
  return { mappings, source, declined };
}

module.exports = { isBijective, arbitrate };

