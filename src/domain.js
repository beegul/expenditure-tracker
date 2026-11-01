export const TYPES = ['purchase', 'refund', 'income', 'card-payment', 'transfer', 'reimbursement', 'unresolved-movement'];
export const CATEGORIES = ['Uncategorised', 'Groceries', 'Eating out', 'Home', 'Mortgage', 'Utilities', 'Transport', 'Shopping', 'Entertainment', 'Health', 'Other'];
export const ACCOUNTS = [
  { id: 'personal', name: 'Nationwide personal', provider: 'nationwide', ownership: 'personal', kind: 'current' },
  { id: 'joint', name: 'Nationwide joint', provider: 'nationwide', ownership: 'joint', kind: 'current' },
  { id: 'credit', name: 'Nationwide credit card', provider: 'nationwide', ownership: 'personal', kind: 'card' },
  { id: 'amex', name: 'American Express', provider: 'amex', ownership: 'personal', kind: 'card' }
];
export const uid = () => globalThis.crypto.randomUUID();
export const merchantKey = text => text.trim().toLowerCase().replace(/\s+/g, ' ');
export const money = cents => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(cents / 100);
export function pennies(value) {
  const s = String(value).trim().replace(/[£,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error('Use a GBP amount with at most two decimal places.');
  const [whole, fraction = ''] = s.replace('-', '').split('.');
  const n = (s.startsWith('-') ? -1 : 1) * (Number(whole) * 100 + Number(fraction.padEnd(2, '0')));
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e12) throw new Error('Amount is too large.');
  return n;
}
export function dateISO(value) {
  const s = String(value).trim(); let parts;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) parts = s.split('-').map(Number);
  else if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(s)) {
    const [d, m, y] = s.split(/[/-]/).map(Number); parts = [y, m, d];
  } else {
    const match = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})$/.exec(s);
    if (!match) throw new Error('Date must be DD/MM/YYYY, YYYY-MM-DD or DD MMM YYYY.');
    const month = match[2].slice(0, 3).toLowerCase();
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthIndex = months.indexOf(month);
    if (monthIndex < 0) throw new Error('Date contains an unknown month.');
    parts = [Number(match[3]), monthIndex + 1, Number(match[1])];
  }
  const [y, m, d] = parts;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) throw new Error('Invalid calendar date.');
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function boundary(year, month, day) {
  return new Date(Date.UTC(year, month, Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate()))).toISOString().slice(0, 10);
}
export function period(date, payday = 15) {
  if (!Number.isInteger(payday) || payday < 1 || payday > 31) throw new Error('Payday must be 1 to 31.');
  const iso = dateISO(date), [y, m] = iso.split('-').map(Number);
  let month = m - 1;
  if (iso < boundary(y, month, payday)) month--;
  const start = boundary(y, month, payday), end = boundary(y, month + 1, payday);
  return { key: start.slice(0, 7), start, end, label: new Date(start + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
}
export function periodByKey(key, payday) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw new Error('Choose a valid period.');
  return period(boundary(Number(key.slice(0, 4)), Number(key.slice(5)) - 1, payday), payday);
}
export function emptyState() { return { version: 1, payday: 15, accounts: structuredClone(ACCOUNTS), transactions: [], rules: [], reimbursements: [] }; }
export function suggestion(state, description) {
  const key = merchantKey(description), rule = state.rules.find(r => r.merchant === key);
  if (rule) return { share: rule.share, category: rule.category, reason: 'Your remembered exact-merchant rule', confidence: 'Rule match' };
  const history = state.transactions.filter(t => merchantKey(t.description) === key && t.type === 'purchase' && t.share !== null);
  if (history.length && history.every(t => t.share === history[0].share && t.category === history[0].category)) return { share: history[0].share, category: history[0].category, reason: `${history.length} consistent confirmed choice(s); confirm before use`, confidence: 'History suggestion' };
  return { share: null, category: 'Uncategorised', reason: history.length ? 'Previous choices differ; review needed' : 'No confirmed merchant history', confidence: 'Unresolved' };
}
export function confirmTransaction(state, id, patch, remember = false) {
  const next = structuredClone(state), t = next.transactions.find(t => t.id === id);
  if (!t) throw new Error('Transaction not found.');
  Object.assign(t, patch);
  if (t.type === 'purchase' && t.share === null) throw new Error('Choose a household share.');
  if (t.type === 'refund' && !t.refundOf) throw new Error('Link the refund to its purchase.');
  if (remember && t.type === 'purchase') {
    const merchant = merchantKey(t.description);
    next.rules = next.rules.filter(r => r.merchant !== merchant);
    next.rules.push({ merchant, share: t.share, category: t.category });
  }
  validateState(next); return next;
}
export function needsReview(state, t) {
  if (t.fundingReview || t.type === 'unresolved-movement') return true;
  if (t.type === 'purchase') return t.share === null;
  if (t.type === 'refund') return !t.refundOf;
  if (t.type === 'reimbursement') return !state.reimbursements.some(r => r.transferIds.includes(t.id));
  return false;
}
export function expense(state, t) {
  if (t.type !== 'purchase' || t.share === null) return { personal: 0, household: 0, funded: 0, paid: 0, due: 0 };
  const refunds = state.transactions.filter(r => r.type === 'refund' && r.refundOf === t.id).reduce((s, r) => s + r.amount, 0);
  const net = -t.amount - refunds, household = Math.round(net * t.share / 100);
  const funded = state.accounts.find(a => a.id === t.accountId)?.ownership === 'personal' ? household : 0;
  const paid = state.reimbursements.flatMap(r => r.allocations).filter(a => a.transactionId === t.id).reduce((s, a) => s + a.amount, 0);
  return { personal: net - household, household, funded, paid, due: funded - paid };
}
export function summary(state, key, today = new Date().toISOString().slice(0, 10)) {
  const p = periodByKey(key, state.payday);
  const total = { ...p, personal: 0, household: 0, funded: 0, paid: 0, due: 0, priorDue: 0, review: 0, priorReview: 0, incomplete: today < p.end };
  for (const t of state.transactions) {
    const linked = t.type === 'refund' && state.transactions.find(x => x.id === t.refundOf);
    const k = period(linked ? linked.date : t.date, state.payday).key;
    if (k === key) {
      const e = expense(state, t);
      for (const name of ['personal', 'household', 'funded', 'paid', 'due']) total[name] += e[name];
      if (needsReview(state, t)) total.review++;
    } else if (k < key) {
      total.priorDue += expense(state, t).due;
      if (needsReview(state, t)) total.priorReview++;
    }
  }
  return total;
}
export function addReimbursement(state, { date, allocations, note = '', transferIds = [] }) {
  const next = structuredClone(state), seen = new Set();
  if (!allocations.length) throw new Error('Select at least one expense and allocation.');
  for (const a of allocations) {
    const t = state.transactions.find(t => t.id === a.transactionId);
    if (!t || seen.has(t.id) || !Number.isSafeInteger(a.amount) || a.amount <= 0 || a.amount > expense(state, t).due) throw new Error('Allocation must not exceed the amount owed on an eligible expense.');
    seen.add(t.id);
  }
  next.reimbursements.push({ id: uid(), date: dateISO(date), note, allocations, transferIds });
  validateState(next); return next;
}
export function reconcile(state, reimbursementId, transactionId) {
  const next = structuredClone(state), r = next.reimbursements.find(r => r.id === reimbursementId), t = next.transactions.find(t => t.id === transactionId);
  if (!r || !t) throw new Error('Record or transfer not found.');
  if (next.reimbursements.some(r => r.transferIds.includes(t.id))) throw new Error('Transfer is already reconciled.');
  const account = next.accounts.find(a => a.id === t.accountId), amount = r.allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(t.amount) !== amount || !['transfer', 'reimbursement', 'unresolved-movement'].includes(t.type) || !((account.ownership === 'joint' && t.amount < 0) || (account.ownership === 'personal' && account.kind === 'current' && t.amount > 0))) throw new Error('Choose an exact matching joint debit or personal-current credit.');
  if (r.transferIds.some(id => next.transactions.find(x => x.id === id)?.accountId === t.accountId)) throw new Error('This account side is already linked.');
  r.transferIds.push(t.id); t.type = 'reimbursement'; t.fundingReview = false;
  validateState(next); return next;
}
export function parseCSV(text) {
  return parseCSVRecords(text).map(record => record.fields);
}
function parseCSVRecords(text) {
  const rows = []; let row = [], field = '', quoted = false, closed = false, line = 1, rowLine = 1;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++; }
      else if (quoted) { quoted = false; closed = true; }
      else if (field !== '' || closed) throw new Error('Unexpected quote in CSV field.');
      else quoted = true;
    } else if (c === ',' && !quoted) { row.push(field); field = ''; closed = false; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field); if (row.some(s => s.trim())) rows.push({ fields: row, line: rowLine });
      row = []; field = ''; closed = false; line++; rowLine = line;
    } else {
      if (closed) throw new Error('Unexpected text after closing CSV quote.');
      field += c;
      if ((c === '\n' || c === '\r') && quoted) {
        if (c === '\r' && input[i + 1] === '\n') { field += '\n'; i++; }
        line++;
      }
    }
  }
  if (quoted) throw new Error('Unclosed quote in CSV.');
  row.push(field); if (row.some(s => s.trim())) rows.push({ fields: row, line: rowLine });
  if (!rows.length) throw new Error('CSV is empty.');
  return rows;
}
const normaliseHeader = value => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const aliases = {
  date: ['date', 'transaction date', 'date of transaction', 'posted date', 'posting date', 'when'],
  description: ['description', 'transaction', 'transactions', 'transaction description', 'transaction details', 'details', 'merchant', 'payee', 'narrative', 'who'],
  amount: ['amount', 'transaction amount', 'amount gbp'],
  debit: ['paid out', 'debit', 'money out', 'withdrawal', 'debit amount'],
  credit: ['paid in', 'credit', 'money in', 'deposit', 'credit amount'],
  reference: ['transaction id', 'unique transaction id', 'transaction identifier']
};
function mapHeaders(headers) {
  const normalised = headers.map(normaliseHeader), mapping = {}, ambiguous = new Set();
  for (const [name, names] of Object.entries(aliases)) {
    const matches = normalised.flatMap((header, i) => names.includes(header) ? [i] : []);
    mapping[name] = matches.length === 1 ? matches[0] : -1;
    if (matches.length > 1) ambiguous.add(name);
  }
  return { mapping, ambiguous };
}
export function inferAccount(records, filename = '') {
  const metadata = records.slice(0, 50).flatMap(record => {
    const label = normaliseHeader(record.fields[0] || '');
    return label === 'account name' && record.fields[1] ? [record.fields[1].toLowerCase()] : [];
  }).join(' ');
  const source = `${metadata} ${filename.toLowerCase()}`;
  if (/american express|\bamex\b/.test(source)) return 'amex';
  if (/\bnationwide\b/.test(source) && /credit\s*card|\bcredit\b/.test(source)) return 'credit';
  if (/\bnationwide\b/.test(source) && /\bjoint\b/.test(source)) return 'joint';
  if (/\bnationwide\b/.test(source) && /\bpersonal\b/.test(source)) return 'personal';
  return null;
}
export function inspectCSV(text, { filename = '' } = {}) {
  const records = parseCSVRecords(text);
  const candidates = records.slice(0, 50).flatMap((record, index) => {
    const headers = record.fields.map(s => s.trim()), { mapping, ambiguous } = mapHeaders(headers);
    if (mapping.date < 0 || mapping.description < 0) return [];
    const hasAmount = mapping.amount >= 0 || (mapping.debit >= 0 && mapping.credit >= 0);
    const score = Number(hasAmount) * 10 + Number(mapping.reference >= 0) + Math.max(0, headers.length - 1) / 1000;
    return [{ index, headers, mapping, ambiguous, score, hasAmount, line: record.line }];
  });
  if (!candidates.length) {
    const first = records[0];
    if (!first) throw new Error('CSV is empty.');
    throw new Error('Could not find a transaction header with a date and description. Export the transactions table as CSV.');
  }
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = candidates[0];
  const tied = candidates.filter(c => c.score === selected.score);
  const rows = records.slice(selected.index + 1);
  const mapping = { ...selected.mapping, automatic: selected.hasAmount && selected.ambiguous.size === 0 && tied.length === 1 };
  return {
    headers: selected.headers,
    rows: rows.map(r => r.fields),
    rowLines: rows.map(r => r.line),
    mapping,
    headerLine: selected.line,
    firstLine: rows[0]?.line ?? selected.line + 1,
    automatic: mapping.automatic,
    inferredAccountId: inferAccount(records.slice(0, selected.index), filename),
    candidateHeaders: tied.map(c => ({ line: c.line, headers: c.headers }))
  };
}
export function previewImport(state, csv, accountId, mapping = csv.mapping, convention = 'provider') {
  const account = state.accounts.find(a => a.id === accountId);
  if (!account) throw new Error('Choose an account.');
  if (mapping.date < 0 || mapping.description < 0 || (mapping.amount < 0 && mapping.debit < 0 && mapping.credit < 0)) throw new Error('Map date, description and amount, or debit/credit columns.');
  const errors = [], candidates = [], counts = new Map();
  csv.rows.forEach((row, i) => {
    try {
      if (row.length !== csv.headers.length) throw new Error('Column count does not match header.');
      const date = dateISO(row[mapping.date]), description = row[mapping.description].trim();
      if (!description) throw new Error('Description is empty.');
      let amount;
      if (mapping.amount >= 0) {
        amount = pennies(row[mapping.amount]);
        if (convention === 'out-positive' || (convention === 'provider' && account.kind === 'card')) amount = -amount;
      } else {
        const debit = mapping.debit >= 0 && row[mapping.debit].trim() ? pennies(row[mapping.debit]) : 0;
        const credit = mapping.credit >= 0 && row[mapping.credit].trim() ? pennies(row[mapping.credit]) : 0;
        if (debit < 0 || credit < 0 || (debit && credit)) throw new Error('Debit/credit must be positive with only one populated.');
        amount = credit - debit;
      }
      if (!amount) throw new Error('Zero amount needs manual investigation.');
      const reference = mapping.reference >= 0 ? row[mapping.reference].trim() : '';
      const fingerprint = JSON.stringify([accountId, date, merchantKey(description), amount]);
      const occurrence = (counts.get(fingerprint) || 0) + 1; counts.set(fingerprint, occurrence);
      const importKey = reference ? JSON.stringify([accountId, 'id', reference]) : JSON.stringify([fingerprint, occurrence]);
      const prior = [...state.transactions, ...candidates].find(t => t.importKey === importKey);
      if (reference && prior && (prior.amount !== amount || prior.date !== date || merchantKey(prior.description) !== merchantKey(description))) throw new Error('Reference ID conflicts with another transaction.');
      const hinted = /payment|transfer|reimburse|salary|refund|cash|interest/i.test(description);
      candidates.push({ id: uid(), date, description, accountId, amount, type: amount < 0 && !hinted ? 'purchase' : 'unresolved-movement', share: null, category: 'Uncategorised', refundOf: null, fundingReview: false, importKey, duplicate: !!prior, occurrence, hasReference: !!reference, suggestion: suggestion(state, description) });
    } catch (e) { errors.push({ row: csv.rowLines?.[i] ?? csv.firstLine + i, message: e.message }); }
  });
  return { candidates, errors, ambiguous: candidates.some(t => !t.hasReference) };
}
export function acceptImport(state, preview) {
  if (preview.errors.length) throw new Error('Resolve every import error before importing.');
  const next = structuredClone(state);
  for (const t of preview.candidates.filter(t => !t.duplicate)) {
    if (next.transactions.some(x => x.importKey === t.importKey)) continue;
    const { duplicate, occurrence, hasReference, suggestion: hint, ...transaction } = t;
    next.transactions.push(transaction);
  }
  validateState(next); return next;
}
export function validateState(s) {
  if (!s || s.version !== 1 || !Number.isInteger(s.payday) || s.payday < 1 || s.payday > 31 || !Array.isArray(s.accounts) || !Array.isArray(s.transactions) || !Array.isArray(s.rules) || !Array.isArray(s.reimbursements)) throw new Error('Unsupported or invalid backup.');
  const unique = (items, name) => { const ids = items.map(t => t?.id); if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error(`Invalid ${name} IDs.`); };
  unique(s.accounts, 'account'); unique(s.transactions, 'transaction'); unique(s.reimbursements, 'reimbursement');
  if (s.accounts.length !== 4 || ACCOUNTS.some(a => !s.accounts.some(x => x.id === a.id && x.provider === a.provider && x.kind === a.kind && x.ownership === a.ownership))) throw new Error('Backup must retain four account sources and ownership.');
  if (s.accounts.some(a => typeof a.name !== 'string' || !a.name.trim())) throw new Error('Account names are required.');
  for (const t of s.transactions) {
    dateISO(t.date);
    if (typeof t.description !== 'string' || !t.description.trim() || !s.accounts.some(a => a.id === t.accountId) || !Number.isSafeInteger(t.amount) || !t.amount || Math.abs(t.amount) > 1e12 || !TYPES.includes(t.type) || !CATEGORIES.includes(t.category) || (t.share !== null && (!Number.isInteger(t.share) || t.share < 0 || t.share > 100)) || typeof t.fundingReview !== 'boolean') throw new Error('Invalid transaction fields.');
    if ((t.type === 'purchase' && t.amount >= 0) || (['refund', 'income'].includes(t.type) && t.amount <= 0)) throw new Error('Transaction direction conflicts with type.');
    if (t.refundOf) {
      const p = s.transactions.find(p => p.id === t.refundOf && p.type === 'purchase');
      if (t.type !== 'refund' || !p || p.accountId !== t.accountId) throw new Error('Invalid refund link.');
    }
    if (t.importKey !== undefined && typeof t.importKey !== 'string') throw new Error('Invalid import key.');
    if (t.type === 'card-payment' && s.accounts.find(a => a.id === t.accountId).ownership === 'joint' && !t.fundingReview) throw new Error('Joint-funded card payments must remain flagged for funding review.');
  }
  if (!Number.isSafeInteger(s.transactions.reduce((total, t) => total + Math.abs(t.amount), 0))) throw new Error('Combined transaction amounts exceed safe integer precision.');
  const keys = s.transactions.filter(t => t.importKey).map(t => t.importKey);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate import identity.');
  for (const p of s.transactions.filter(t => t.type === 'purchase')) if (s.transactions.filter(t => t.refundOf === p.id).reduce((v, r) => v + r.amount, 0) > -p.amount) throw new Error('Refunds exceed purchase.');
  const merchants = new Set();
  for (const r of s.rules) {
    if (typeof r?.merchant !== 'string' || !r.merchant || r.merchant !== merchantKey(r.merchant) || merchants.has(r.merchant) || !Number.isInteger(r.share) || r.share < 0 || r.share > 100 || !CATEGORIES.includes(r.category)) throw new Error('Invalid merchant rule.');
    merchants.add(r.merchant);
  }
  const transfers = new Set();
  for (const r of s.reimbursements) {
    dateISO(r.date);
    if (typeof r.note !== 'string' || !Array.isArray(r.allocations) || !r.allocations.length || !Array.isArray(r.transferIds)) throw new Error('Invalid reimbursement.');
    const allocated = new Set();
    for (const a of r.allocations) {
      const t = s.transactions.find(t => t.id === a.transactionId);
      if (!t || t.type !== 'purchase' || t.share === null || s.accounts.find(x => x.id === t.accountId).ownership !== 'personal' || !Number.isSafeInteger(a.amount) || a.amount <= 0 || allocated.has(t.id)) throw new Error('Invalid allocation.');
      allocated.add(t.id);
    }
    const total = r.allocations.reduce((v, a) => v + a.amount, 0), sides = new Set();
    for (const id of r.transferIds) {
      const t = s.transactions.find(t => t.id === id), a = s.accounts.find(a => a.id === t?.accountId);
      if (!t || transfers.has(id) || sides.has(a.id) || t.type !== 'reimbursement' || Math.abs(t.amount) !== total || !((a.ownership === 'joint' && t.amount < 0) || (a.ownership === 'personal' && a.kind === 'current' && t.amount > 0))) throw new Error('Invalid reconciled transfer.');
      transfers.add(id); sides.add(a.id);
    }
  }
  for (const t of s.transactions.filter(t => t.type === 'purchase')) {
    const paid = s.reimbursements.flatMap(r => r.allocations).filter(a => a.transactionId === t.id).reduce((n, a) => n + a.amount, 0);
    if (paid > -t.amount) throw new Error('Recorded reimbursements exceed the original gross purchase.');
  }
  return s;
}
export function exportBackup(state) { validateState(state); return JSON.stringify(state, null, 2); }
export function importBackup(text) { return validateState(JSON.parse(text)); }
export const STORAGE_KEY = 'commonplace-v1';
export function saveState(storage, state) { storage.setItem(STORAGE_KEY, exportBackup(state)); }
export function loadState(storage) { const value = storage.getItem(STORAGE_KEY); return value ? importBackup(value) : emptyState(); }
export function demoState() {
  const s = emptyState();
  const entries = [
    ['2026-10-16', 'Tesco', -6842, 'personal', 100, 'Groceries'],
    ['2026-10-17', 'Starbucks', -475, 'amex', 0, 'Eating out'],
    ['2026-10-18', 'Home store', -12000, 'credit', 60, 'Home'],
    ['2026-10-19', 'Mortgage', -112000, 'joint', 100, 'Mortgage'],
    ['2026-10-20', 'Broadband', -3200, 'joint', 100, 'Utilities'],
    ['2026-10-22', 'Local market', -2850, 'personal', null, 'Uncategorised'],
    ['2026-10-23', 'Train tickets', -2400, 'amex', 0, 'Transport'],
    ['2026-09-20', 'Tesco', -5100, 'personal', 100, 'Groceries'],
    ['2026-09-21', 'Starbucks', -820, 'personal', 0, 'Eating out'],
    ['2026-09-22', 'Mortgage', -112000, 'joint', 100, 'Mortgage'],
    ['2026-09-25', 'Home store', -4800, 'credit', 100, 'Home'],
    ['2026-08-18', 'Tesco', -6100, 'personal', 100, 'Groceries'],
    ['2026-08-19', 'Mortgage', -112000, 'joint', 100, 'Mortgage']
  ];
  s.transactions = entries.map(([date, description, amount, accountId, share, category], i) => ({ id: `demo-${i}`, date, description, amount, accountId, share, category, type: 'purchase', refundOf: null, fundingReview: false }));
  s.transactions.push({ id: 'demo-refund', date: '2026-10-26', description: 'Home store return', amount: 2000, accountId: 'credit', share: null, category: 'Home', type: 'refund', refundOf: 'demo-2', fundingReview: false });
  s.transactions.push({ id: 'demo-salary', date: '2026-10-15', description: 'Monthly salary', amount: 280000, accountId: 'personal', share: null, category: 'Other', type: 'income', refundOf: null, fundingReview: false });
  s.reimbursements.push({ id: 'demo-settlement', date: '2026-10-15', note: 'September part settlement', allocations: [{ transactionId: 'demo-7', amount: 5100 }], transferIds: [] });
  return validateState(s);
}
