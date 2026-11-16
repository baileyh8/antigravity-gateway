'use strict';
const MAX_TOOL_SCHEMA_DEPTH = 32;

function mergeToolSchema(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return target;
  const merged = { ...target };

  for (const key of ['type', 'description', 'enum', 'nullable', 'additionalProperties']) {
    if (target[key] !== undefined) merged[key] = target[key];
    else if (source[key] !== undefined) merged[key] = source[key];
  }
  if ((!merged.type || merged.type === 'object') && (target.properties || source.properties)) {
    merged.properties = { ...(source.properties || {}), ...(target.properties || {}) };
  }
  if ((!merged.type || merged.type === 'object') && (target.required || source.required)) {
    merged.required = [...new Set([...(source.required || []), ...(target.required || [])].map(String))];
  }
  if (!merged.type || merged.type === 'array') {
    for (const key of ['items', 'prefixItems']) {
      if (target[key] !== undefined) merged[key] = target[key];
      else if (source[key] !== undefined) merged[key] = source[key];
    }
  }
  return merged;
}

function unionCandidateScore(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || schema.type === 'null') return -1;
  let score = schema.type ? 10 : 0;
  if (schema.type === 'object') score += 20 + Object.keys(schema.properties || {}).length;
  if (schema.type === 'array') score += 15 + (schema.items ? 1 : 0);
  if (Array.isArray(schema.enum) && schema.enum.length) score += 2;
  return score;
}

function cleanToolSchema(schema, depth = 0) {
  if (depth > MAX_TOOL_SCHEMA_DEPTH) return { type: 'object' };
  if (schema === true) return { type: 'string' };
  if (!schema || schema === false || typeof schema !== 'object') return { type: 'object' };
  if (Array.isArray(schema)) return schema.map((item) => cleanToolSchema(item, depth + 1));

  let output = {};
  for (const key of ['description', 'enum', 'nullable', 'required', 'additionalProperties']) {
    if (schema[key] === undefined) continue;
    if (key === 'enum' && Array.isArray(schema[key])) output[key] = schema[key].map(String);
    else if (key === 'required' && Array.isArray(schema[key])) output[key] = schema[key].map(String);
    else output[key] = schema[key];
  }

  const rawType = schema.type;
  if (Array.isArray(rawType)) {
    const types = rawType.map(String).filter(Boolean);
    const nonNull = types.filter((type) => type !== 'null');
    output.type = nonNull[0] || 'object';
    if (types.includes('null')) output.nullable = true;
  } else if (typeof rawType === 'string' && rawType) {
    output.type = rawType;
  }

  if (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
    output.properties = Object.fromEntries(Object.entries(schema.properties)
      .map(([name, value]) => [name, cleanToolSchema(value, depth + 1)]));
  }

  if (Array.isArray(schema.items)) {
    // Draft-07 tuple schemas use an array in `items`; project them onto the
    // Draft 2020-12 shape understood by current clients before adding the
    // homogeneous fallback required by the Cloud Code schema validator.
    output.prefixItems = schema.items.map((item) => cleanToolSchema(item, depth + 1));
  } else if (schema.items && typeof schema.items === 'object') {
    output.items = cleanToolSchema(schema.items, depth + 1);
  }

  if (Array.isArray(schema.prefixItems)) {
    output.prefixItems = schema.prefixItems.map((item) => cleanToolSchema(item, depth + 1));
  }

  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      output = mergeToolSchema(output, cleanToolSchema(branch, depth + 1));
    }
  }

  const unionSource = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : [];
  if (unionSource.length) {
    const nullable = unionSource.some((item) => item?.type === 'null');
    const variants = unionSource.map((item) => cleanToolSchema(item, depth + 1));
    const candidate = variants
      .filter((item) => item?.type !== 'null')
      .sort((left, right) => unionCandidateScore(right) - unionCandidateScore(left))[0];
    if (candidate) output = mergeToolSchema(output, candidate);
    if (nullable) output.nullable = true;
  }

  if (!output.type && output.prefixItems) output.type = 'array';
  if (!output.type && (output.properties || output.required)) output.type = 'object';

  // Cloud Code rejects every array node that lacks an `items` field. Keep
  // tuple semantics in `prefixItems`, while adding the same permissive string
  // fallback used by mature Gemini/Antigravity schema bridges.
  if (output.type === 'array' && !output.items) output.items = { type: 'string' };
  return output;
}

module.exports = {cleanToolSchema};
