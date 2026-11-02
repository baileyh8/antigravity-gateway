'use strict';
const fs = require('node:fs');
// Read newest records first, with bounded memory regardless of file size.
function* reverseLines(file, maxBytes = 32 * 1024 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    let position = fs.fstatSync(fd).size;
    let read = 0;
    let carry = '';
    while (position > 0 && read < maxBytes) {
      const length = Math.min(64 * 1024, position, maxBytes - read);
      position -= length; read += length;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, position);
      // latin1 preserves byte boundaries when a UTF-8 codepoint spans chunks.
      const parts = (buffer.toString('latin1') + carry).split('\n');
      carry = parts.shift();
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i]) yield Buffer.from(parts[i], 'latin1').toString('utf8');
      if (carry.length > 65536) carry = '';
    }
    if (!position && carry) yield Buffer.from(carry, 'latin1').toString('utf8');
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function* forwardLines(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    let carry = '';
    let length;
    while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      const parts = (carry + buffer.subarray(0, length).toString('latin1')).split('\n');
      carry = parts.pop();
      for (const part of parts) if (part) yield Buffer.from(part, 'latin1').toString('utf8');
      if (carry.length > 65536) carry = '';
    }
    if (carry) yield Buffer.from(carry, 'latin1').toString('utf8');
  } finally { fs.closeSync(fd); }
}
module.exports = { reverseLines, forwardLines };
