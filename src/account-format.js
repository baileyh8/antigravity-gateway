'use strict';

function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.indexOf('@');
  if (at <= 0) return value ? `${value.slice(0, 1)}***` : '';
  const local = value.slice(0, at);
  const domain = value.slice(at);
  const visible = local.length >= 4 ? `${local[0]}***${local[local.length - 1]}` : `${local[0]}***`;
  return `${visible}${domain}`;
}

module.exports = { maskEmail };
