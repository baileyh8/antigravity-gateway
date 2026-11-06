'use strict';

// DeepSeek Harness (`dsh`) presents itself as `deepseek-harness/<version>`.
// Captured against this gateway from dsh 0.2.1-rc.3 (631 requests between
// 2026-11-02 and 2026-11-06). Its tool names are lowercase and collide with
// ordinary English words, so identity requires three independent signals:
// the user agent, a complete captured system-prompt section, and at least
// one exactly captured tool declaration. Identity selects translation only;
// it never authenticates callers or grants conversation/permission access.
const DSH_CLIENT_PROFILE = 'dsh-0.2.1-captured';
const DSH_USER_AGENT = /^deepseek-harness\/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:\s|\(|$)/;

// One complete sentence per tool plugin (dsh-tool-fs 0.2.1-rc.2). Matching the
// whole sentence keeps ordinary prose such as "read the file" out of the rule.
const READ_SECTION = 'Use the read tool \u2014 not shell commands like cat \u2014 to inspect text files. Use offset and limit to continue reading large files.';
const WRITE_SECTION = 'Read an existing file before overwriting it with write (the default fs-observation-policy requires it)';
const WRITE_EDIT_TAIL = ' and prefer edit for targeted changes.';
const EDIT_SECTION = 'Read a file before editing it (the default fs-observation-policy requires it), unless you just created or edited it in this session.';

// dsh validates its own declarations against a JSON Schema subset, so the
// shape reaching the gateway is already explicit and stable. Match on the
// declared field set and required list instead of a content hash: a version
// bump that adds a description must not silently drop the whole profile.
const BASH_DESCRIPTION_PREFIX = 'Execute a bash command (`bash -c`) and return its stdout/stderr.';
const DECLARATIONS = {
  read: {
    fields: { file_path: 'string', offset: 'number', limit: 'number' },
    required: ['file_path'],
    description: 'Read a UTF-8 text file and return line-numbered content.'
  },
  write: {
    fields: { file_path: 'string', content: 'string' },
    required: ['file_path', 'content'],
    description: 'Create or fully replace a UTF-8 text file.'
  },
  edit: {
    fields: { file_path: 'string', old_string: 'string', new_string: 'string', replace_all: 'boolean' },
    required: ['file_path', 'old_string', 'new_string'],
    description: 'Edit an existing UTF-8 text file by replacing literal text.'
  }
};

function capturedDshTool(tool) {
  const rule = DECLARATIONS[tool.name];
  const s = tool.schema;
  if (!rule || tool.internal || (tool.kind && tool.kind !== 'function')) return false;
  if (!s || s.type !== 'object' || s.additionalProperties !== false || !s.properties) return false;
  if (String(tool.description || '').split('\n')[0] !== rule.description) return false;
  const names = Object.keys(s.properties).filter(name => !(name === 'sandbox_permissions' || name === 'justification'));
  if (!names.every(name => rule.fields[name] && s.properties[name]?.type === rule.fields[name])) return false;
  const declared = (s.required || []).filter(name => !(name === 'sandbox_permissions' || name === 'justification'));
  return rule.required.every(name => declared.includes(name)) && declared.every(name => rule.required.includes(name));
}

// The bash declaration carries a long multi-sentence description. Only its
// captured opening is fixed; the body ends with deployment-specific detail.
function capturedDshBash(tool) {
  const s = tool.schema;
  if (!s || s.type !== 'object' || s.additionalProperties !== false || !s.properties) return false;
  if (String(tool.description || '').slice(0, BASH_DESCRIPTION_PREFIX.length) !== BASH_DESCRIPTION_PREFIX) return false;
  const p = s.properties;
  if (p.command?.type !== 'string' || p.description?.type !== 'string') return false;
  const required = s.required || [];
  return required.includes('command') && required.includes('description')
    && Object.keys(p).every(name => ['command', 'description', 'timeoutMs', 'workdir', 'run_in_background', 'sandbox_permissions', 'justification'].includes(name));
}

function capturedDshDeclarations(normalized) {
  return (normalized.tools || []).filter(tool => capturedDshTool(tool) || capturedDshBash(tool));
}

function hasSection(system) {
  return system.includes(READ_SECTION) || system.includes(EDIT_SECTION)
    || (system.includes(WRITE_SECTION) && system.includes(WRITE_EDIT_TAIL));
}

function capturedDshClient(req, normalized) {
  if (normalized.protocol !== 'chat') return '';
  if (!DSH_USER_AGENT.test(req?.headers?.['user-agent'] || '')) return '';
  if (!hasSection(String(normalized.system || ''))) return '';
  return capturedDshDeclarations(normalized).length ? DSH_CLIENT_PROFILE : '';
}

// Translate only the sentence that names a mapped tool, and only when that
// tool actually becomes a native declaration. Everything else — user content,
// project rules, shell examples — stays byte for byte.
function dshSystemText(text, mappings) {
  let source = String(text || '');
  if (!hasSection(source)) return source;
  if (mappings.has('read')) {
    source = source.split(READ_SECTION).join(
      'Use the view_file tool \u2014 not shell commands like cat \u2014 to inspect text files. Use StartLine and EndLine to continue reading large files.');
  }
  if (mappings.has('write')) {
    const tail = mappings.has('edit') ? ' and prefer replace_file_content for targeted changes.' : WRITE_EDIT_TAIL;
    source = source.split(WRITE_SECTION).join(
      'Read an existing file before overwriting it with write_to_file (the default fs-observation-policy requires it)')
      .split(WRITE_EDIT_TAIL).join(tail);
  } else if (mappings.has('edit')) {
    source = source.split(WRITE_EDIT_TAIL).join(' and prefer replace_file_content for targeted changes.');
  }
  if (mappings.has('edit')) {
    // "Read a file before editing it" starts with the plain verb, not the tool.
    source = source.split(EDIT_SECTION).join(
      'Read a file before editing it with replace_file_content (the default fs-observation-policy requires it), unless you just created or edited it in this session.');
  }
  return source;
}

module.exports = {
  DSH_CLIENT_PROFILE,
  DSH_USER_AGENT,
  READ_SECTION,
  WRITE_SECTION,
  WRITE_EDIT_TAIL,
  EDIT_SECTION,
  BASH_DESCRIPTION_PREFIX,
  capturedDshBash,
  capturedDshClient,
  capturedDshDeclarations,
  capturedDshTool,
  dshSystemText
};
