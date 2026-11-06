'use strict';

// Semantic identification of client tool declarations.
//
// A tool name is untrusted input: any client may declare `read` with unrelated
// parameters, and a new client may declare `open_file` with exactly the
// parameters of a file reader. Identity therefore comes from the declared
// argument shape. Every property is mapped to a role first; an unplaceable
// property disqualifies the whole tool, because a partial shape would make the
// forward and reverse translations disagree.

const ROLES = {
  path: ['file_path', 'path', 'absolute_path', 'target_file', 'file', 'filename', 'filepath'],
  content: ['content', 'contents', 'text', 'code'],
  old: ['old_string', 'old_text', 'old_str', 'search'],
  new: ['new_string', 'new_text', 'new_str', 'replace'],
  command: ['command', 'cmd', 'script', 'shell_command'],
  workdir: ['workdir', 'cwd', 'directory'],
  offset: ['offset', 'start_line'],
  limit: ['limit', 'count', 'lines'],
  timeout: ['timeout', 'timeout_ms', 'timeoutms', 'timeout_seconds'],
  background: ['run_in_background', 'background'],
  replaceAll: ['replace_all', 'replaceall'],
  description: ['description']
};

const ROLE_OF = new Map();
for (const [role, names] of Object.entries(ROLES)) for (const name of names) ROLE_OF.set(name.toLowerCase(), role);

// Each family lists the roles it accepts, the roles that must be present and
// required, and the native name each role maps to. Anything outside this list
// is a reason to decline the tool rather than guess at a translation.
const FAMILIES = {
  read: {
    native: 'view_file',
    names: ['read', 'read_file', 'readfile', 'read_file_content', 'open_file', 'openfile', 'view_file', 'cat', 'file_read', 'read_text_file'],
    required: ['path'],
    optional: ['offset', 'limit'],
    strings: ['path'],
    numbers: ['offset', 'limit'],
    target: { path: 'AbsolutePath', offset: 'StartLine', limit: 'EndLine' },
    lineRange: true
  },
  write: {
    native: 'write_to_file',
    names: ['write', 'write_file', 'writefile', 'create_file', 'save_file', 'write_to_file', 'save', 'create'],
    required: ['path', 'content'],
    optional: [],
    strings: ['path', 'content'],
    target: { path: 'TargetFile', content: 'CodeContent' }
  },
  edit: {
    native: 'replace_file_content',
    names: ['edit', 'edit_file', 'editfile', 'replace', 'str_replace', 'str_replace_editor', 'replace_file_content', 'patch_file', 'apply_edit'],
    required: ['path', 'old', 'new'],
    optional: ['replaceAll'],
    strings: ['path', 'old', 'new'],
    booleans: ['replaceAll'],
    target: { path: 'TargetFile', old: 'TargetContent', new: 'ReplacementContent', replaceAll: 'AllowMultiple' }
  },
  exec: {
    native: 'run_command',
    names: ['bash', 'sh', 'shell', 'exec', 'run_command', 'terminal', 'exec_command', 'shell_command', 'command', 'run_shell'],
    required: ['command'],
    optional: ['description', 'workdir', 'timeout', 'background'],
    strings: ['command', 'description', 'workdir'],
    numbers: ['timeout'],
    booleans: ['background'],
    target: { command: 'CommandLine', description: 'Description', workdir: 'Cwd', timeout: 'TimeoutMs', background: 'RunInBackground' }
  }
};

const NUMERIC_TYPES = new Set(['number', 'integer']);

function typeMatches(family, role, type) {
  if (family.strings.includes(role)) return type === 'string';
  if (family.numbers?.includes(role)) return NUMERIC_TYPES.has(type);
  if (family.booleans?.includes(role)) return type === 'boolean';
  return false;
}

// Returns `{ family, familyName, roles }` or null. Null means "decline": the
// caller must leave the declaration exactly as submitted.
function classifyTool(tool) {
  if (!tool || tool.internal || (tool.kind && tool.kind !== 'function')) return null;
  const schema = tool.schema;
  if (!schema || schema.type !== 'object' || schema.additionalProperties !== false) return null;
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object') return null;
  const entries = Object.entries(properties);
  if (!entries.length) return null;

  const byRole = new Map();
  for (const [name, property] of entries) {
    const role = ROLE_OF.get(String(name).toLowerCase());
    if (!role) return null;
    if (byRole.has(role)) return null;
    byRole.set(role, { name, property });
  }

  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  for (const name of required) {
    const role = ROLE_OF.get(String(name).toLowerCase());
    if (!role || !byRole.has(role)) return null;
  }

  for (const [familyName, family] of Object.entries(FAMILIES)) {
    const allowed = new Set([...family.required, ...family.optional]);
    if ([...byRole.keys()].some(role => !allowed.has(role))) continue;
    if (!family.required.every(role => byRole.has(role) && required.has(byRole.get(role).name))) continue;
    if ([...required].some(name => !allowed.has(ROLE_OF.get(String(name).toLowerCase())))) continue;
    let consistent = true;
    for (const [role, { property }] of byRole) {
      const type = property && typeof property === 'object' ? property.type : undefined;
      if (!typeMatches(family, role, type)) { consistent = false; break; }
    }
    if (!consistent) continue;
    return {
      family,
      familyName,
      roles: byRole,
      // Shape alone cannot separate a real file reader from a custom tool that
      // happens to take one path argument. When this is the only family in the
      // request, parameterCount and nameKnown are the additional evidence: a
      // bare one-argument tool stays untranslated.
      parameterCount: entries.length,
      nameKnown: family.names.includes(String(tool.name || '').toLowerCase())
    };
  }
  return null;
}

// Builds a rule in the same shape the captured profiles use, so the existing
// declaration and reverse-call machinery applies unchanged.
function buildRule(classified) {
  const { family, roles } = classified;
  const parameters = {};
  for (const [role, { name }] of roles) parameters[name] = family.target[role];
  return { name: family.native, parameters, semantic: true, ...(family.lineRange ? { lineRange: true } : {}) };
}

const NATIVE_NAMES = new Set(Object.values(FAMILIES).map(family => family.native));

module.exports = { ROLES, FAMILIES, NATIVE_NAMES, classifyTool, buildRule };

