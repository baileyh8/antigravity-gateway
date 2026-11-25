'use strict';

// Semantic identification of client tool declarations.
//
// A tool name is untrusted input: any client may declare `read` with unrelated
// parameters, and a new client may declare `open_file` with exactly the
// parameters of a file reader. Identity therefore comes from the declared
// argument shape. Every property is mapped to a role first; an unplaceable
// property disqualifies the whole tool, because a partial shape would make the
// forward and reverse translations disagree.
//
// Scope note, so the gaps read as deliberate rather than forgotten. The agy
// client advertises a larger native tool set, but only these families have a
// captured declaration we can translate onto:
//   mapped   view_file, write_to_file, replace_file_content, run_command,
//            manage_task, search_web
//   no schema  grep_search, find_by_name, list_dir, search_in_file,
//              read_url_content - names are known from the client's tool
//              inventory, their parameter objects are assembled at runtime and
//              are not in the binary, so nothing is guessed here
//   no runtime send_message, schedule, invoke_subagent, define_subagent,
//              manage_subagents - these drive Antigravity's own subagent
//              runtime, which a passthrough gateway does not provide

const ROLES = {
  path: ['file_path', 'path', 'absolute_path', 'target_file', 'file', 'filename', 'filepath'],
  content: ['content', 'contents', 'text', 'code'],
  old: ['old_string', 'old_text', 'old_str', 'old_content', 'target_content', 'search', 'find'],
  new: ['new_string', 'new_text', 'new_str', 'new_content', 'replacement_content', 'replace', 'replacement'],
  command: ['command', 'cmd', 'script', 'shell_command'],
  query: ['query', 'q', 'search_query'],
  domain: ['domain', 'site', 'allowed_domains'],
  workdir: ['workdir', 'cwd', 'directory', 'working_directory', 'working_dir', 'dir'],
  offset: ['offset', 'start_line', 'startline', 'line_start', 'from_line'],
  limit: ['limit', 'count', 'lines', 'max_lines', 'num_lines'],
  endLine: ['end_line', 'endline', 'line_end', 'to_line'],
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
    optional: ['offset', 'limit', 'endLine'],
    strings: ['path'],
    numbers: ['offset', 'limit', 'endLine'],
    target: { path: 'AbsolutePath', offset: 'StartLine', limit: 'EndLine', endLine: 'EndLine' },
    lineRange: true
  },
  write: {
    native: 'write_to_file',
    names: ['write', 'write_file', 'writefile', 'create_file', 'save_file', 'write_to_file', 'save', 'create', 'create_or_update_file', 'file_write', 'write_text_file'],
    required: ['path', 'content'],
    optional: [],
    strings: ['path', 'content'],
    target: { path: 'TargetFile', content: 'CodeContent' }
  },
  edit: {
    native: 'replace_file_content',
    names: ['edit', 'edit_file', 'editfile', 'replace', 'str_replace', 'replace_file_content', 'patch', 'patch_file', 'apply_edit', 'file_edit', 'replace_in_file', 'str_replace_file'],
    required: ['path', 'old', 'new'],
    optional: ['replaceAll'],
    strings: ['path', 'old', 'new'],
    booleans: ['replaceAll'],
    target: { path: 'TargetFile', old: 'TargetContent', new: 'ReplacementContent', replaceAll: 'AllowMultiple' }
  },
  exec: {
    native: 'run_command',
    names: ['bash', 'sh', 'shell', 'exec', 'run_command', 'terminal', 'exec_command', 'shell_command', 'command', 'run_shell', 'run_shell_command', 'execute_command', 'run_bash', 'execute_bash'],
    required: ['command'],
    optional: ['description', 'workdir', 'timeout', 'background'],
    strings: ['command', 'description', 'workdir'],
    numbers: ['timeout'],
    booleans: ['background'],
    target: { command: 'CommandLine', description: 'Description', workdir: 'Cwd', timeout: 'TimeoutMs', background: 'RunInBackground' }
  },
  search: {
    native: 'search_web',
    names: ['web_search', 'search_web', 'websearch', 'google_search', 'search', 'web_lookup'],
    required: ['query'],
    optional: ['domain'],
    strings: ['query', 'domain'],
    target: { query: 'query', domain: 'domain' }
  }
};

const NUMERIC_TYPES = new Set(['number', 'integer']);
const COMBINATORS = ['allOf', 'anyOf', 'oneOf', '$ref', 'not', 'if', 'then', 'else'];

function extractScalarType(property) {
  if (!property || typeof property !== 'object' || Array.isArray(property)) return null;
  if (typeof property.type === 'string') {
    if (COMBINATORS.some(k => k in property)) return null;
    return { type: property.type, nullable: false };
  }
  if (Array.isArray(property.type)) {
    const nonNull = property.type.filter(t => t !== 'null');
    if (nonNull.length === 1 && property.type.length === 2 && typeof nonNull[0] === 'string' && !COMBINATORS.some(k => k in property)) {
      return { type: nonNull[0], nullable: true };
    }
    return null;
  }
  const branches = Array.isArray(property.anyOf) ? property.anyOf : Array.isArray(property.oneOf) ? property.oneOf : null;
  if (branches && branches.length === 2) {
    const nullBranch = branches.find(b => b && typeof b === 'object' && b.type === 'null' && Object.keys(b).every(k => ['type', 'title', 'description'].includes(k)));
    const valueBranch = branches.find(b => b !== nullBranch);
    if (nullBranch && valueBranch && typeof valueBranch.type === 'string' && !COMBINATORS.some(k => k in valueBranch)) {
      return { type: valueBranch.type, nullable: true };
    }
  }
  return null;
}

function typeMatches(family, role, type) {
  if (family.strings.includes(role)) return type === 'string';
  if (family.numbers?.includes(role)) return NUMERIC_TYPES.has(type);
  if (family.booleans?.includes(role)) return type === 'boolean';
  return false;
}

function inspectTool(tool) {
  if (!tool || tool.internal || (tool.kind && tool.kind !== 'function')) return { classified: null, reason: 'not_client_function' };
  const schema = tool.schema;
  if (!schema || schema.type !== 'object') return { classified: null, reason: 'schema_not_object' };
  if (COMBINATORS.some(k => k in schema)) return { classified: null, reason: 'schema_has_root_combinator' };
  if (schema.additionalProperties !== false && schema.additionalProperties !== undefined) {
    return { classified: null, reason: 'additionalProperties_not_closed' };
  }
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object') return { classified: null, reason: 'missing_properties' };
  const entries = Object.entries(properties);
  if (!entries.length) return { classified: null, reason: 'empty_properties' };

  const byRole = new Map();
  for (const [name, property] of entries) {
    const role = ROLE_OF.get(String(name).toLowerCase());
    if (!role) return { classified: null, reason: `unknown_property:${name}` };
    if (byRole.has(role)) return { classified: null, reason: `duplicate_role:${role}` };
    byRole.set(role, { name, property });
  }

  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  for (const name of required) {
    const role = ROLE_OF.get(String(name).toLowerCase());
    if (!role || !byRole.has(role)) return { classified: null, reason: `unknown_required:${name}` };
  }

  if (byRole.has('limit') && byRole.has('endLine')) {
    return { classified: null, reason: 'ambiguous_line_range_limit_and_endLine' };
  }

  let mismatchReason = 'no_matching_family';
  let specificReason = '';
  for (const [familyName, family] of Object.entries(FAMILIES)) {
    const allowed = new Set([...family.required, ...family.optional]);
    if ([...byRole.keys()].some(role => !allowed.has(role))) continue;
    if (!family.required.every(role => byRole.has(role) && required.has(byRole.get(role).name))) {
      mismatchReason = `missing_required_for_${familyName}`;
      continue;
    }
    if ([...required].some(name => !allowed.has(ROLE_OF.get(String(name).toLowerCase())))) continue;
    let consistent = true;
    const scalarTypes = new Map();
    for (const [role, { name, property }] of byRole) {
      const extracted = extractScalarType(property);
      if (!extracted || !typeMatches(family, role, extracted.type)) {
        consistent = false;
        specificReason = specificReason || `unsupported_type:${name}`;
        break;
      }
      if (extracted.nullable && required.has(name)) {
        consistent = false;
        specificReason = specificReason || `nullable_required_property:${name}`;
        break;
      }
      scalarTypes.set(name, extracted);
    }
    if (!consistent) continue;
    return {
      classified: {
        family,
        familyName,
        roles: byRole,
        scalarTypes,
        // Shape alone cannot separate a real file reader from a custom tool that
        // happens to take one path argument. When this is the only family in the
        // request, parameterCount and nameKnown are the additional evidence: a
        // bare one-argument tool stays untranslated.
        parameterCount: entries.length,
        nameKnown: family.names.includes(String(tool.name || '').toLowerCase())
      },
      reason: null
    };
  }
  return { classified: null, reason: specificReason || mismatchReason };
}

// Returns `{ family, familyName, roles }` or null. Null means "decline": the
// caller must leave the declaration exactly as submitted.
function classifyTool(tool) {
  return inspectTool(tool).classified;
}

function explainToolDecline(tool) {
  return inspectTool(tool).reason;
}

// Builds a rule in the same shape the captured profiles use, so the existing
// declaration and reverse-call machinery applies unchanged.
function buildRule(classified) {
  const { family, roles } = classified;
  const parameters = {};
  for (const [role, { name }] of roles) parameters[name] = family.target[role];
  const directEndLine = Boolean(family.lineRange && roles.has('endLine'));
  const lineRange = Boolean(family.lineRange && !directEndLine);
  return {
    name: family.native,
    parameters,
    semantic: true,
    ...(lineRange ? { lineRange: true } : {}),
    ...(directEndLine ? { directEndLine: true } : {})
  };
}

const NATIVE_NAMES = new Set(Object.values(FAMILIES).map(family => family.native));

module.exports = { ROLES, FAMILIES, NATIVE_NAMES, extractScalarType, classifyTool, explainToolDecline, buildRule };

