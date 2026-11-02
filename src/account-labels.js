'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { maskEmail } = require('./account-format');
class AccountLabels {
  constructor({configDir}) {
    this.file = path.join(configDir, 'account-labels.json');
    try { this.labels = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.labels = {}; }
    this.labels = Object.fromEntries(Object.entries(this.labels).filter(([id, label]) => typeof id === 'string' && typeof label === 'string' && label.includes('@')));
  }
  refresh() {
    try {
      const stamp = fs.statSync(this.file).mtimeMs;
      if (stamp === this.stamp) return;
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const valid = Object.fromEntries(Object.entries(saved).filter(([id, label]) => typeof label === 'string' && label.includes('@')));
      this.labels = {...valid, ...this.labels};
      this.stamp = stamp;
    } catch { /* keep the last known labels */ }
  }
  capture(accounts) {
    this.refresh();
    let changed = false;
    for (const account of accounts) {
      const label = account.emailMasked || account.email ? maskEmail(account.emailMasked || account.email) : '';
      if (!account.id || !label.includes('@') || this.labels[account.id] === label) continue;
      this.labels[account.id] = label; changed = true;
    }
    if (!changed) return;
    this.refresh();
    try {
      fs.mkdirSync(path.dirname(this.file), {recursive:true});
      const temporary = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(this.labels), {mode:0o600});
      fs.renameSync(temporary, this.file);
    } catch { /* label persistence must not affect proxy requests */ }
  }
  all() { this.refresh(); return {...this.labels}; }
}
module.exports = {AccountLabels};
