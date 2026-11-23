'use strict';

const { GatewayError } = require('./protocol');
const { normalizeMime } = require('./multimedia');

function parseMultipart(buffer, contentType) {
  const boundaryValue = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = boundaryValue?.[1] || boundaryValue?.[2];
  if (!boundary) throw new GatewayError('multipart/form-data 缺少 boundary。', { code: 'invalid_multipart', status: 400 });
  const marker = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];
  let cursor = 0;
  while (true) {
    const start = buffer.indexOf(marker, cursor);
    if (start < 0) break;
    const next = buffer.indexOf(marker, start + marker.length);
    if (next < 0) break;
    let part = buffer.subarray(start + marker.length, next);
    if (part.subarray(0, 2).toString() === '\r\n') part = part.subarray(2);
    if (part.subarray(-2).toString() === '\r\n') part = part.subarray(0, -2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd > 0) {
      const headers = part.subarray(0, headerEnd).toString('utf8');
      const body = part.subarray(headerEnd + 4);
      const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || '';
      const name = disposition.match(/name="([^"]+)"/i)?.[1] || '';
      const filename = disposition.match(/filename="([^"]*)"/i)?.[1];
      const mediaType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || '';
      if (name && filename !== undefined) files.push({ name, filename, mediaType: normalizeMime(mediaType, filename), buffer: body });
      else if (name) fields[name] = body.toString('utf8');
    }
    cursor = next;
  }
  return { fields, files };
}

module.exports = { parseMultipart };
