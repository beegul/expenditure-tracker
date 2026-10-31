import { TYPES, CATEGORIES, uid, money, pennies, period, periodByKey, emptyState, demoState, suggestion, expense, summary, needsReview, confirmTransaction, addReimbursement, reconcile, inspectCSV, previewImport, acceptImport, exportBackup, importBackup, loadState, saveState, STORAGE_KEY, validateState } from './domain.js';

const app = document.querySelector('#app'), dialog = document.querySelector('#editor');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortDate = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const option = (value, label, selected) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
const names = { purchase: 'Purchase', refund: 'Refund', income: 'Income', 'card-payment': 'Card repayment', transfer: 'Own-account transfer', reimbursement: 'Joint reimbursement', 'unresolved-movement': 'Unresolved cash movement' };
let state, persisted, loadError = '', isDemo = false, realState, view = 'month', key, query = '', accountFilter = '', statusFilter = '', csv = null, preview = null;
try { persisted = localStorage.getItem(STORAGE_KEY); state = loadState(localStorage); }
catch (e) { loadError = e.message; }
key = period(today(), state?.payday || 15).key;
function notify(message, error = false) {
  const el = document.querySelector('#notice'); el.textContent = message; el.className = error ? 'visible error' : 'visible';
  clearTimeout(notify.timer); notify.timer = setTimeout(() => { el.className = ''; }, 7000);
}
function commit(next) {
  validateState(next);
  if (!isDemo) {
    if (localStorage.getItem(STORAGE_KEY) !== persisted) throw new Error('Another tab changed this ledger. Reload this page before editing to avoid overwriting it.');
    saveState(localStorage, next); persisted = localStorage.getItem(STORAGE_KEY);
  }
  state = next; render();
}
function download(text, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function accountName(id) { return state.accounts.find(a => a.id === id)?.name || id; }
function tag(t) {
  if (needsReview(state, t)) return '<span class="tag pending">Needs review</span>';
  if (t.type !== 'purchase') return `<span class="tag muted">${esc(names[t.type])}</span>`;
  return `<span class="tag ${t.share === 100 ? 'household' : t.share === 0 ? 'personal' : 'split'}">${t.share === 100 ? 'Household' : t.share === 0 ? 'Personal' : `${t.share}% household`}</span>`;
}
function status(t) {
  if (t.type !== 'purchase' || t.share === null) return t.type === 'refund' && t.refundOf ? 'Linked refund' : 'Not expenditure';
  if (state.accounts.find(a => a.id === t.accountId).ownership === 'joint') return 'Joint-paid';
  const e = expense(state, t);
  if (!e.funded && !e.paid) return 'Personal';
  return e.due < 0 ? 'Overpaid / credit' : e.due === 0 ? 'Reimbursed' : e.paid ? 'Partly reimbursed' : 'Awaiting reimbursement';
}
function pageHeader(title, text, actions = '') {
  return `<header class="page-header"><div><h1>${title}</h1><p>${text}</p></div><div class="actions">${actions}</div></header>`;
}
function table(transactions, empty = 'No transactions match this view.') {
  if (!transactions.length) return `<div class="empty"><h3>${empty}</h3><p>Import a bank CSV or add a transaction. Nothing is sent to a server.</p><button class="primary" data-action="nav" data-view="import">Import a CSV</button> <button data-action="add">Add transaction</button></div>`;
  return `<div class="table-wrap"><table class="ledger"><caption class="sr-only">Transactions and reimbursement status</caption><thead><tr><th>Date</th><th>Description / merchant</th><th>Account</th><th class="number">Money in / out</th><th>Classification</th><th>Category</th><th>Settlement</th><th class="number">Amount due</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${transactions.map(t => {
    const e = expense(state, t);
    return `<tr class="${needsReview(state, t) ? 'unresolved' : ''}"><td class="nowrap">${shortDate(t.date)}</td><td class="merchant">${esc(t.description)}${t.type !== 'purchase' ? `<small>${esc(names[t.type])}</small>` : ''}</td><td><small>${esc(accountName(t.accountId))}</small></td><td class="number ${t.amount > 0 ? 'positive' : ''}">${money(t.amount)}</td><td>${tag(t)}</td><td>${esc(t.category)}</td><td><small>${esc(status(t))}</small></td><td class="number">${t.type === 'purchase' && t.share !== null ? money(e.due) : '&mdash;'}</td><td><button class="text-button" data-action="edit" data-id="${esc(t.id)}" aria-label="Edit ${esc(t.description)}">Review</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function monthly() {
  const s = summary(state, key, today()), relevant = state.transactions.filter(t => period(t.date, state.payday).key === key);
  const filtered = relevant.filter(t => (!query || `${t.description} ${t.category}`.toLowerCase().includes(query.toLowerCase())) && (!accountFilter || t.accountId === accountFilter) && (!statusFilter || (statusFilter === 'review' ? needsReview(state, t) : t.type === 'purchase'))).sort((a, b) => b.date.localeCompare(a.date));
  const prevEnd = new Date(s.end + 'T12:00:00Z'); prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  return pageHeader(s.label, `${shortDate(s.start)} – ${shortDate(prevEnd.toISOString().slice(0, 10))} · settles ${shortDate(s.end)}`, '<button data-action="add">+ Add transaction</button><button class="primary" data-action="nav" data-view="import">Import CSV</button>') +
    `<div class="period-bar"><button data-action="prev" aria-label="Previous payday period">&larr;</button><label>Payday period <input id="period-picker" type="month" value="${key}"></label><button data-action="next" aria-label="Next payday period">&rarr;</button><span class="tag muted">${s.incomplete ? 'Period in progress' : 'Completed period'}</span></div>
    <section class="totals" aria-label="Spending totals"><div><span>Personal spending</span><strong>${money(s.personal)}</strong><small>Personal share of purchases</small></div><div><span>Total household</span><strong>${money(s.household)}</strong><small>Across all paying accounts</small></div><div><span>Personally funded household</span><strong>${money(s.funded)}</strong><small>After attributable refunds</small></div></section>
    <section class="settlement-strip"><div><h2>${s.review || s.priorReview ? 'Provisional settlement' : 'Settlement position'}</h2><p>${s.review} need review in this period${s.priorReview ? ` · ${s.priorReview} in prior periods` : ''}. Purchases stay in their original period.</p></div><div><span>This period remaining</span><strong>${money(s.due)}</strong></div><div><span>Prior outstanding / credit</span><strong>${money(s.priorDue)}</strong></div><button data-action="nav" data-view="settlement">View breakdown &rarr;</button></section>
    ${s.review || s.priorReview ? '<div class="banner">Unresolved purchases and unlinked credits are excluded from confirmed spending totals. Review cash movements too: they may be refunds or reimbursements. <button class="text-button" data-action="nav" data-view="review">Open review queue</button></div>' : ''}
    <section class="section"><div class="section-heading"><h2>Transaction ledger <span class="count">${relevant.length}</span></h2><span class="subtle">GBP · debits negative, credits positive</span></div><div class="filters"><label class="search">Search <input id="search" type="search" placeholder="Merchant or category" value="${esc(query)}"></label><label>Account <select id="account-filter">${option('', 'All accounts', accountFilter)}${state.accounts.map(a => option(a.id, a.name, accountFilter)).join('')}</select></label><label>Show <select id="status-filter">${option('', 'All movements', statusFilter)}${option('purchase', 'Purchases', statusFilter)}${option('review', 'Needs review', statusFilter)}</select></label></div>${table(filtered, relevant.length ? 'No matching transactions' : 'Your ledger starts here')}</section>
    <p class="footnote">Recorded reimbursement allocated to this period: ${money(s.paid)}. Linked refunds reduce the original purchase period, even if received later. Income and transfers are cash movement, not spending.</p>`;
}
function trends() {
  const year = Number(key.slice(0, 4)), currentKey = period(today(), state.payday).key;
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`).filter(k => k <= currentKey);
  const stats = months.map(k => summary(state, k, today()));
  const personal = stats.reduce((n, s) => n + s.personal, 0), household = stats.reduce((n, s) => n + s.household, 0);
  const max = Math.max(1, ...stats.map(s => s.personal + s.household));
  let previous;
  return pageHeader('The bigger picture', 'Compare completed payday periods, not calendar months.', `<label>Period year <input id="year-picker" type="number" min="1900" max="2200" value="${year}"></label>`) +
    `<section class="totals"><div><span>${year} personal spending</span><strong>${money(personal)}</strong><small>Named periods January onwards</small></div><div><span>${year} household spending</span><strong>${money(household)}</strong><small>All accounts, net of linked refunds</small></div><div><span>Combined expenditure</span><strong>${money(personal + household)}</strong><small>${stats.some(s => s.incomplete) ? 'Includes current partial period' : 'Completed periods only'}</small></div></section>
    <div class="banner">YTD starts on January's payday; ${state.payday === 1 ? 'there are no January carryover days' : `1–${state.payday - 1} January belongs to the previous December`}. Current-period values are partial and never used for a full-month comparison. Empty periods mean no recorded data, not verified zero spending.</div>
    <section class="section"><div class="section-heading"><h2>Period comparison</h2><span class="legend"><i class="personal-swatch"></i> Personal <i class="household-swatch"></i> Household</span></div>${stats.length ? `<div class="table-wrap"><table><caption class="sr-only">Month-to-month spending and percentage change</caption><thead><tr><th>Start month</th><th>Spending distribution</th><th class="number">Personal</th><th class="number">Household</th><th class="number">Combined change</th><th>Status</th></tr></thead><tbody>${stats.map(s => {
      const hasData = state.transactions.some(t => period(t.date, state.payday).key === s.key), combined = s.personal + s.household;
      const change = s.incomplete || !hasData || !previous || previous.incomplete || previous.review || s.review || !(previous.personal + previous.household) ? '—' : `${((combined / (previous.personal + previous.household) - 1) * 100).toFixed(1)}%`;
      previous = hasData ? s : undefined;
      return `<tr><td><button class="text-button" data-action="period" data-key="${s.key}">${esc(s.label)}</button></td><td class="bar-cell"><div class="bar" aria-label="${money(combined)} combined"><span style="width:${s.personal / max * 100}%" class="personal-bar"></span><span style="width:${s.household / max * 100}%" class="household-bar"></span></div></td><td class="number">${money(s.personal)}</td><td class="number">${money(s.household)}</td><td class="number">${change}</td><td><span class="tag ${s.review ? 'pending' : 'muted'}">${!hasData ? 'No recorded data' : s.incomplete ? 'Partial period' : s.review ? `${s.review} need review` : 'Completed'}</span></td></tr>`;
    }).join('')}</tbody></table></div>` : '<p>No periods have started in this year.</p>'}</section>`;
}
function settlements() {
  const purchases = state.transactions.filter(t => t.type === 'purchase' && (expense(state, t).funded > 0 || expense(state, t).paid > 0)).sort((a, b) => a.date.localeCompare(b.date));
  const eligible = purchases.filter(t => expense(state, t).due > 0), credit = purchases.filter(t => expense(state, t).due < 0);
  const s = summary(state, key, today()), count = state.transactions.filter(t => needsReview(state, t)).length;
  return pageHeader('Household reimbursements', 'Record money you have already received. This app never makes a bank transfer.', `<button class="primary" data-action="allocate"${eligible.length ? '' : ' disabled'}>Record reimbursement</button>`) +
    `<section class="settlement-strip"><div><h2>${count ? 'Provisional until reviewed' : 'Your settlement ledger'}</h2><p>${count} unresolved across all periods</p></div><div><span>${esc(s.label)}</span><strong>${money(s.due)}</strong></div><div><span>Prior outstanding / credit</span><strong>${money(s.priorDue)}</strong></div></section>
    ${credit.length ? '<div class="banner">A refund or classification correction arrived after reimbursement. Negative amounts are credits owed back to the household; they are not silently discarded. Export the ledger and resolve these credits manually outside the app.</div>' : ''}
    <section class="section"><h2>Personally funded household purchases</h2><p>Joint-paid purchases have no reimbursement entitlement. A partly household purchase earns only its household share, less attributable refunds.</p>${purchases.length ? `<div class="table-wrap"><table><caption class="sr-only">Reimbursement breakdown by original spending period</caption><thead><tr><th>Purchase</th><th>Original period</th><th class="number">Net household share</th><th class="number">Recorded reimbursement</th><th class="number">Remaining / credit</th></tr></thead><tbody>${purchases.map(t => { const e = expense(state, t); return `<tr><td>${esc(t.description)}<small>${shortDate(t.date)} · ${esc(accountName(t.accountId))}</small></td><td>${esc(period(t.date, state.payday).label)}</td><td class="number">${money(e.funded)}</td><td class="number">${money(e.paid)}</td><td class="number">${money(e.due)}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty"><h3>No confirmed household purchases funded personally</h3><p>Review your imports to classify purchases before recording reimbursements.</p></div>'}</section>
    <section class="section"><h2>Reimbursement records</h2><p>Link both imported transfer sides to the same record. Matching is explicit and never subtracts the reimbursement again.</p>${state.reimbursements.length ? state.reimbursements.map(r => `<article class="record"><div><strong>${money(r.allocations.reduce((n, a) => n + a.amount, 0))}</strong><span>${shortDate(r.date)} · ${esc(r.note || 'Manual reimbursement')}</span><small>${r.allocations.length} expense allocation(s) · ${r.transferIds.length} bank side(s) linked</small>${r.allocations.map(a => `<small>${esc(state.transactions.find(t => t.id === a.transactionId)?.description)}: ${money(a.amount)}</small>`).join('')}${r.transferIds.map(id => `<small>Linked: ${esc(accountName(state.transactions.find(t => t.id === id).accountId))} · ${shortDate(state.transactions.find(t => t.id === id).date)}</small>`).join('')}</div><div class="actions"><button data-action="reconcile" data-id="${esc(r.id)}">Link imported transfer</button><button class="text-button" data-action="remove-record" data-id="${esc(r.id)}">Undo record</button></div></article>`).join('') : '<p class="empty-inline">No reimbursements recorded yet.</p>'}</section>`;
}
function reviewPage() {
  const transactions = state.transactions.filter(t => needsReview(state, t)).sort((a, b) => a.date.localeCompare(b.date));
  return pageHeader('A little attention, a clearer ledger', 'Review every uncertain purchase and cash movement, across all periods.') +
    `<div class="banner">Suggestions come only from your confirmed merchant history or explicitly remembered rules. Nothing is classified with hidden AI. One-off edits never change a merchant rule.</div><section class="section"><h2>Needs review <span class="count">${transactions.length}</span></h2>${transactions.length ? table(transactions) : '<div class="empty"><h3>You are all caught up</h3><p>New and ambiguous transactions will appear here after import.</p><button data-action="nav" data-view="month">Return to the ledger</button></div>'}</section>`;
}
function imports() {
  return pageHeader('Bring your statements together', 'CSV only. Your file is read on this device and never uploaded.') +
    `<section class="import-layout"><div class="section"><h2>Choose a statement</h2><p>Nationwide current: positive paid-out / paid-in columns, or a signed Amount. Cards: positive charges, negative credits by default. Check the preview against your statement.</p><label>Paying account <select id="import-account">${state.accounts.map(a => option(a.id, `${a.name} (${a.kind})`, imports.account || 'personal')).join('')}</select></label><label>Amount convention <select id="convention">${option('provider', 'Provider default', imports.convention || 'provider')}${option('in-positive', 'Signed amount: credits positive', imports.convention || 'provider')}${option('out-positive', 'Signed amount: charges positive', imports.convention || 'provider')}</select></label><label class="file-field">Choose CSV <input id="csv-file" type="file" accept=".csv,text/csv"></label><p class="footnote">DD/MM/YYYY or YYYY-MM-DD dates, comma-separated UTF-8 CSV, GBP amounts. No real bank sample has been supplied; supported layouts are verified with fictional fixtures only. OFX / Excel are not supported: export CSV instead.</p></div><aside class="import-notes"><h2>Before you import</h2><ol><li>Choose the account the statement belongs to.</li><li>Map unfamiliar column names.</li><li>Check debit / credit direction and duplicate rows.</li><li>Import, then confirm the review queue.</li></ol><p>Transfers and card repayments are not purchases. Joint-funded card repayments stay visibly unresolved until funding is reconciled explicitly.</p></aside></section>
    ${csv ? `<section class="section"><h2>Map columns</h2><p>${csv.rows.length} data row(s). Select Amount <em>or</em> paid-out / paid-in; Amount takes priority. Map Reference only to a genuine unique transaction ID, not a payment reference reused across purchases.</p><div class="mapping">${['date', 'description', 'amount', 'debit', 'credit', 'reference'].map(name => `<label>${({ debit: 'Paid out', credit: 'Paid in', reference: 'Unique transaction ID' })[name] || name}<select data-map="${name}">${option('-1', 'Not used', String(csv.mapping[name]))}${csv.headers.map((h, i) => option(String(i), h || `Column ${i + 1}`, String(csv.mapping[name]))).join('')}</select></label>`).join('')}</div><button class="primary" data-action="preview">Build import preview</button></section>` : ''}
    ${preview ? previewHTML() : ''}`;
}
function previewHTML() {
  const newCount = preview.candidates.filter(t => !t.duplicate).length;
  return `<section class="section"><div class="section-heading"><h2>Import preview</h2><span>${newCount} new · ${preview.candidates.length - newCount} overlapping · ${preview.errors.length} errors</span></div>${preview.errors.length ? `<div class="validation" role="alert"><strong>Fix the source CSV or mapping, then rebuild the preview.</strong><ul>${preview.errors.map(e => `<li>Row ${e.row}: ${esc(e.message)}</li>`).join('')}</ul></div>` : ''}
    ${preview.ambiguous ? '<div class="banner">No unique IDs on some rows. Overlaps are matched by account, date, exact normalised description, amount and occurrence count. Identical purchases within one file stay separate. Partial overlapping files cannot prove whether an identical row is the same purchase: check skipped rows and explicitly keep any genuinely new occurrence.</div>' : ''}
    <div class="table-wrap"><table><caption class="sr-only">Normalized import preview</caption><thead><tr><th>Date</th><th>Description</th><th class="number">Normalized movement</th><th>Initial review</th><th>Duplicate decision</th></tr></thead><tbody>${preview.candidates.map((t, i) => `<tr><td>${esc(t.date)}</td><td>${esc(t.description)}</td><td class="number">${money(t.amount)}</td><td>${esc(t.type === 'purchase' ? t.suggestion.confidence : 'Cash movement: confirm type')}</td><td>${t.duplicate ? t.hasReference ? 'Skipped: same unique ID' : `<label><input type="checkbox" data-keep="${i}"> Keep as genuinely new</label>` : 'New transaction'}</td></tr>`).join('')}</tbody></table></div><label class="ack"><input id="import-ack" type="checkbox"> I checked account, signs and duplicate decisions against my statement.</label><button class="primary" data-action="accept"${preview.errors.length || !preview.candidates.length ? ' disabled' : ''}>Import reviewed rows</button></section>`;
}
function settings() {
  return pageHeader('Your data, your device', 'Account setup, payday periods and portable backups.') +
    `<section class="section narrow"><h2>Payday & accounts</h2><p>Payday is the start of a named period. Days beyond the end of a short month use that month's last day. Changing payday regroupes all purchases, not reimbursement allocations.</p><form id="settings-form"><label>Monthly payday (1–31) <input name="payday" type="number" min="1" max="31" required value="${state.payday}"></label>${state.accounts.map(a => `<label>${esc(a.provider === 'amex' ? 'American Express personal card' : `Nationwide ${a.id === 'joint' ? 'joint current' : a.kind === 'card' ? 'personal credit card' : 'personal current'}`)}<input name="account-${a.id}" value="${esc(a.name)}" required maxlength="80"></label>`).join('')}<button class="primary">Save settings</button></form></section>
    <section class="section narrow"><h2>Backup & restore</h2><p>Stored only in this browser's local storage for this exact website address. Clearing browser data, private browsing or changing address can lose access. Export backups regularly. Backups contain your financial data in plain text: store them securely, never in the public repository.</p><div class="actions"><button data-action="export">Export JSON backup</button><label class="file-button">Restore JSON backup <input id="backup-file" type="file" accept=".json,application/json"></label></div></section>
    <section class="section"><h2>Remembered merchant rules</h2><p>Exact descriptions only, with case and whitespace normalised. History is suggested, not silently applied. Remove a rule to stop suggesting it; existing confirmed transactions are unchanged.</p>${state.rules.length ? state.rules.map(r => `<div class="rule"><div><strong>${esc(r.merchant)}</strong><small>${r.share}% household · ${esc(r.category)}</small></div><button data-action="remove-rule" data-merchant="${esc(r.merchant)}">Forget rule</button></div>`).join('') : '<p class="empty-inline">No rules yet. In a transaction review, explicitly choose “Remember for this exact merchant”.</p>'}</section>`;
}
function render() {
  if (loadError) {
    app.innerHTML = `<main class="recovery"><h1>Your stored ledger needs attention</h1><p role="alert">${esc(loadError)}</p><p>The stored data has not been replaced. Download it for recovery, or restore a known-good backup.</p><button data-action="raw-export">Download stored data</button><label class="file-button">Restore backup<input id="backup-file" type="file" accept=".json"></label><button data-action="reload">Reload</button></main>`; return;
  }
  const count = state.transactions.filter(t => needsReview(state, t)).length;
  const nav = [['month', 'Monthly ledger', '▦'], ['trends', 'Year & comparison', '▤'], ['settlement', 'Reimbursements', '⇄'], ['import', 'Import statements', '+'], ['review', `Review queue${count ? ` (${count})` : ''}`, '✓'], ['settings', 'Data & settings', '⚙']];
  app.innerHTML = `<div class="shell"><aside class="sidebar"><a class="brand" href="#" data-action="nav" data-view="month"><span class="brand-mark">c.</span><span>commonplace<small>Expenditure, understood.</small></span></a><nav aria-label="Main navigation">${nav.map(([id, title, icon]) => `<button data-action="nav" data-view="${id}" class="${view === id ? 'active' : ''}"${view === id ? ' aria-current="page"' : ''}><span aria-hidden="true">${icon}</span>${title}</button>`).join('')}</nav><div class="sidebar-bottom"><span class="local-dot"></span> Local to this browser<p>No bank connection.<br>No financial data uploads.</p><button data-action="export">Export backup</button><button class="demo-button" data-action="demo">${isDemo ? 'Return to my ledger' : 'Explore fictional demo'}</button></div></aside><main id="main"><div class="topline"><span>Personal & household expenditure</span><span>${isDemo ? 'Fictional demo · not saved' : 'Private · on this device'}</span></div>${isDemo ? '<div class="demo-banner"><strong>You are exploring fictional data.</strong> Changes stay in this demo and never touch your ledger. <button data-action="demo">Return to my ledger</button></div>' : ''}${({ month: monthly, trends, settlement: settlements, import: imports, review: reviewPage, settings })[view]()}</main></div>`;
}
function openDialog(html) { dialog.innerHTML = html; dialog.showModal(); }
function formShell(title, body, button = 'Save changes', id = 'transaction-form') {
  return `<form id="${id}"><div class="dialog-heading"><h2>${title}</h2><button type="button" data-action="close" aria-label="Close dialog">×</button></div>${body}<p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" data-action="close">Cancel</button><button class="primary">${button}</button></div></form>`;
}
function editTransaction(id) {
  const t = state.transactions.find(t => t.id === id), hint = suggestion(state, t.description);
  const linked = state.reimbursements.some(r => r.transferIds.includes(id));
  openDialog(formShell(`Review ${esc(t.description)}`, `<input type="hidden" name="id" value="${esc(id)}"><p>${esc(accountName(t.accountId))} · ${esc(t.date)} · <strong>${money(t.amount)}</strong></p><div class="banner"><strong>${esc(hint.confidence)}</strong>: ${esc(hint.reason)}${hint.share !== null ? ` (${hint.share}% household, ${esc(hint.category)})` : ''}. Suggestions require your confirmation.</div><label>Movement type <select name="type" id="edit-type"${linked ? ' disabled' : ''}>${TYPES.map(type => option(type, names[type], t.type)).join('')}</select></label><div id="purchase-fields"><label>Household share <select name="share" id="share-choice">${option('', 'Choose classification', t.share === null ? '' : String(t.share))}${option('0', 'Personal (0% household)', String(t.share))}${option('100', 'Household (100%)', String(t.share))}${option('split', 'Partly household: enter percentage', t.share !== null && t.share > 0 && t.share < 100 ? 'split' : '')}</select></label><label id="split-label">Household percentage <input name="split" type="number" min="1" max="99" value="${t.share > 0 && t.share < 100 ? t.share : hint.share > 0 && hint.share < 100 ? hint.share : 50}"></label><label>Category <select name="category">${CATEGORIES.map(c => option(c, c, t.category)).join('')}</select></label>${hint.share !== null ? '<button type="button" data-action="use-hint">Use suggested classification</button>' : ''}<label class="ack"><input name="remember" type="checkbox"> Remember for this exact merchant (future suggestion)</label></div><div id="refund-fields"><label>Original purchase on this account <select name="refundOf">${option('', 'Choose purchase', t.refundOf || '')}${state.transactions.filter(p => p.type === 'purchase' && p.accountId === t.accountId).map(p => option(p.id, `${p.date} · ${p.description} · ${money(-p.amount)}`, t.refundOf)).join('')}</select></label><p>A linked refund reduces the purchase's original household / personal split, and its reimbursement entitlement.</p></div><p id="movement-help">Income, transfers and repayments do not count as spending. For a reimbursement, save this type and link it to a reimbursement record. Joint-funded card repayments remain in review: record an explicit allocated reimbursement and reclassify the matching debit as reimbursement if that is what it actually funded.</p>${linked ? '<p>This transfer is linked to a reimbursement. Undo that record first to change its type.</p>' : ''}`, 'Confirm transaction'));
  syncEditor();
}
function syncEditor() {
  const type = dialog.querySelector('#edit-type')?.value;
  if (!type) return;
  dialog.querySelector('#purchase-fields').hidden = type !== 'purchase';
  dialog.querySelector('#refund-fields').hidden = type !== 'refund';
  dialog.querySelector('#movement-help').hidden = type === 'purchase' || type === 'refund';
  const isSplit = type === 'purchase' && dialog.querySelector('#share-choice').value === 'split';
  dialog.querySelector('#split-label').hidden = !isSplit;
  dialog.querySelector('[name=split]').disabled = !isSplit;
  dialog.querySelectorAll('#purchase-fields select, #purchase-fields input[type=checkbox]').forEach(field => { field.disabled = type !== 'purchase'; });
  dialog.querySelector('[name=refundOf]').disabled = type !== 'refund';
}
function addDialog() {
  openDialog(formShell('Add a transaction', `<p>Use a manual entry only for transactions missing from your imports. Later CSV imports cannot automatically match a manual entry.</p><label>Date <input name="date" type="date" value="${today()}" required></label><label>Description / merchant <input name="description" required maxlength="200"></label><label>Account <select name="accountId">${state.accounts.map(a => option(a.id, a.name, 'personal')).join('')}</select></label><div class="form-row"><label>Amount (GBP) <input name="amount" inputmode="decimal" required placeholder="0.00"></label><label>Direction <select name="direction"><option value="out">Money out</option><option value="in">Money in</option></select></label></div><p>After saving, review the entry to classify its type and household share.</p>`, 'Add & review', 'add-form'));
}
function allocationDialog() {
  const eligible = state.transactions.filter(t => expense(state, t).due > 0);
  openDialog(formShell('Record a reimbursement received', `<p>Allocate an actual payment to original purchases. This does not send money. Leave an amount blank to skip that expense.</p><label>Date received <input name="date" type="date" required value="${today()}"></label><label>Note <input name="note" maxlength="200" placeholder="e.g. October settlement"></label><div class="allocations">${eligible.map(t => `<label>${esc(t.description)}<small>${esc(period(t.date, state.payday).label)} · ${money(expense(state, t).due)} available</small><input data-allocation="${esc(t.id)}" inputmode="decimal" placeholder="0.00" aria-label="Allocation for ${esc(t.description)}"></label>`).join('')}</div>`, 'Record reimbursement', 'allocation-form'));
}
function reconciliationDialog(id) {
  const r = state.reimbursements.find(r => r.id === id), amount = r.allocations.reduce((n, a) => n + a.amount, 0);
  const matches = state.transactions.filter(t => {
    const a = state.accounts.find(a => a.id === t.accountId);
    return Math.abs(t.amount) === amount && ['transfer', 'reimbursement', 'unresolved-movement'].includes(t.type) && !state.reimbursements.some(r => r.transferIds.includes(t.id)) && !r.transferIds.some(id => state.transactions.find(t => t.id === id).accountId === a.id) && ((a.ownership === 'joint' && t.amount < 0) || (a.ownership === 'personal' && a.kind === 'current' && t.amount > 0));
  });
  openDialog(formShell('Reconcile an imported bank transfer', `<input name="record" type="hidden" value="${esc(id)}"><p>Recorded ${shortDate(r.date)} · <strong>${money(amount)}</strong>. Choose the actual matching bank movement. Date is shown for checking, not guessed automatically. Link the other side separately.</p>${matches.length ? `<label>Matching movement <select name="transactionId">${matches.map(t => option(t.id, `${t.date} · ${accountName(t.accountId)} · ${t.description} · ${money(t.amount)}`, '')).join('')}</select></label>` : '<p>No unlinked exact-amount joint debits or personal-current credits found. Import the relevant statement and review transfer types first.</p>'}<p>Reconciling only adds a bank link; the reimbursement has already been deducted by its allocations.</p>`, 'Link transfer', 'reconcile-form'));
  if (!matches.length) dialog.querySelector('button.primary').disabled = true;
}
async function restore(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Backup exceeds 10 MB.');
  const next = importBackup(await file.text());
  if (isDemo) throw new Error('Return to your own ledger before restoring a backup.');
  openDialog(formShell('Replace ledger from backup?', `<p>This backup contains ${next.transactions.length} transactions, ${next.reimbursements.length} reimbursement records and ${next.rules.length} merchant rules. It will replace this browser's dataset, not merge it.</p><p>Export your current data first if you need to keep it.</p><button type="button" data-action="${loadError ? 'raw-export' : 'export'}">Export current data</button><label class="ack"><input name="approve" type="checkbox" required> I approve replacing the stored ledger with this backup.</label>`, 'Restore backup', 'restore-form'));
  restore.next = next;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-action]'); if (!b) return; e.preventDefault();
  try {
    const action = b.dataset.action;
    if (action === 'close') dialog.close();
    else if (action === 'reload') location.reload();
    else if (action === 'raw-export') download(localStorage.getItem(STORAGE_KEY) || '', 'commonplace-recovery.json');
    else if (action === 'export') download(exportBackup(state), `commonplace${isDemo ? '-fictional-demo' : ''}-${today()}.json`);
    else if (action === 'nav') { view = b.dataset.view; render(); }
    else if (action === 'period') { key = b.dataset.key; view = 'month'; render(); }
    else if (action === 'prev' || action === 'next') {
      const date = new Date(key + '-01T12:00:00Z'); date.setUTCMonth(date.getUTCMonth() + (action === 'prev' ? -1 : 1)); key = date.toISOString().slice(0, 7); render();
    } else if (action === 'demo') {
      if (isDemo) { state = realState; isDemo = false; key = period(today(), state.payday).key; }
      else { realState = state; state = demoState(); isDemo = true; key = '2026-10'; }
      csv = null; preview = null; query = ''; view = 'month'; render();
    } else if (action === 'edit') editTransaction(b.dataset.id);
    else if (action === 'add') addDialog();
    else if (action === 'use-hint') {
      const t = state.transactions.find(t => t.id === dialog.querySelector('[name=id]').value), h = suggestion(state, t.description);
      dialog.querySelector('[name=share]').value = h.share === 0 || h.share === 100 ? String(h.share) : 'split';
      dialog.querySelector('[name=split]').value = h.share; dialog.querySelector('[name=category]').value = h.category; syncEditor();
    } else if (action === 'preview') { preview = previewImport(state, csv, imports.account || 'personal', csv.mapping, imports.convention || 'provider'); render(); }
    else if (action === 'accept') {
      if (!document.querySelector('#import-ack').checked) throw new Error('Check account, signs and duplicate decisions, then confirm the checkbox.');
      const p = structuredClone(preview);
      document.querySelectorAll('[data-keep]:checked').forEach(input => { const t = p.candidates[Number(input.dataset.keep)]; t.duplicate = false; t.importKey += `:confirmed-new:${uid()}`; });
      const count = p.candidates.filter(t => !t.duplicate).length;
      commit(acceptImport(state, p)); csv = null; preview = null; view = 'review'; render(); notify(`${count} transaction(s) imported. Confirm their classifications in review.`);
    } else if (action === 'allocate') allocationDialog();
    else if (action === 'reconcile') reconciliationDialog(b.dataset.id);
    else if (action === 'remove-record') {
      openDialog(formShell('Undo reimbursement record?', `<input name="id" type="hidden" value="${esc(b.dataset.id)}"><p>This removes its allocations and bank links. Linked transfer movements return to review; purchase spending is unchanged.</p><label class="ack"><input name="approve" type="checkbox" required> Undo this record.</label>`, 'Undo record', 'remove-record-form'));
    } else if (action === 'remove-rule') { const next = structuredClone(state); next.rules = next.rules.filter(r => r.merchant !== b.dataset.merchant); commit(next); notify('Rule removed. Confirmed purchases are unchanged.'); }
  } catch (e) { notify(e.message, true); }
});
document.addEventListener('change', async e => {
  const t = e.target;
  try {
    if (t.id === 'period-picker' && t.value) { key = periodByKey(t.value, state.payday).key; render(); }
    else if (t.id === 'year-picker') { const year = Number(t.value); if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new Error('Choose a year from 1900 to 2200.'); key = `${year}-01`; render(); }
    else if (t.id === 'account-filter') { accountFilter = t.value; render(); }
    else if (t.id === 'status-filter') { statusFilter = t.value; render(); }
    else if (t.id === 'import-account') { imports.account = t.value; preview = null; render(); }
    else if (t.id === 'convention') { imports.convention = t.value; preview = null; render(); }
    else if (t.dataset.map) { csv.mapping[t.dataset.map] = Number(t.value); preview = null; render(); }
    else if (t.id === 'edit-type' || t.id === 'share-choice') syncEditor();
    else if (t.id === 'csv-file' && t.files[0]) {
      if (t.files[0].size > 10 * 1024 * 1024) throw new Error('CSV exceeds 10 MB. Export a smaller date range.');
      csv = inspectCSV(await t.files[0].text()); preview = null; render();
    } else if (t.id === 'backup-file' && t.files[0]) await restore(t.files[0]);
  } catch (e) { notify(e.message, true); }
});
document.addEventListener('input', e => {
  if (e.target.id !== 'search') return;
  query = e.target.value; const caret = e.target.selectionStart; render(); const field = document.querySelector('#search'); field.focus(); field.setSelectionRange(caret, caret);
});
document.addEventListener('submit', e => {
  e.preventDefault(); const form = e.target, formId = form.getAttribute('id'), data = new FormData(form);
  try {
    if (formId === 'transaction-form') {
      const t = state.transactions.find(t => t.id === data.get('id'));
      const type = data.get('type') || t.type, share = data.get('share');
      commit(confirmTransaction(state, t.id, { type, share: type === 'purchase' ? share === 'split' ? Number(data.get('split')) : share === '' ? null : Number(share) : null, category: type === 'purchase' ? data.get('category') : 'Other', refundOf: type === 'refund' ? data.get('refundOf') || null : null, fundingReview: type === 'card-payment' && t.accountId === 'joint' }, data.get('remember') === 'on'));
      dialog.close(); notify('Transaction confirmed. Existing merchant rules changed only if requested.');
    } else if (formId === 'add-form') {
      const amount = pennies(data.get('amount')); if (amount <= 0) throw new Error('Enter a positive amount and choose money in or out.');
      const t = { id: uid(), date: data.get('date'), description: data.get('description').trim(), accountId: data.get('accountId'), amount: data.get('direction') === 'out' ? -amount : amount, type: 'unresolved-movement', share: null, category: 'Uncategorised', refundOf: null, fundingReview: false };
      const next = structuredClone(state); next.transactions.push(t); commit(next); dialog.close(); editTransaction(t.id);
    } else if (formId === 'allocation-form') {
      const allocations = [...form.querySelectorAll('[data-allocation]')].filter(i => i.value.trim()).map(i => ({ transactionId: i.dataset.allocation, amount: pennies(i.value) }));
      commit(addReimbursement(state, { date: data.get('date'), note: data.get('note'), allocations })); dialog.close(); notify('Reimbursement recorded. Link the imported bank transfer when available.');
    } else if (formId === 'reconcile-form') {
      commit(reconcile(state, data.get('record'), data.get('transactionId'))); dialog.close(); notify('Transfer linked. Amount owed was not deducted again.');
    } else if (formId === 'remove-record-form') {
      const next = structuredClone(state), r = next.reimbursements.find(r => r.id === data.get('id'));
      for (const id of r.transferIds) { const t = next.transactions.find(t => t.id === id); t.type = 'unresolved-movement'; }
      next.reimbursements = next.reimbursements.filter(r => r.id !== data.get('id')); commit(next); dialog.close(); notify('Reimbursement undone; linked bank movements need review.');
    } else if (formId === 'settings-form') {
      const next = structuredClone(state); next.payday = Number(data.get('payday')); next.accounts.forEach(a => { a.name = data.get(`account-${a.id}`).trim(); }); commit(next); key = period(today(), state.payday).key; render(); notify('Settings saved.');
    } else if (formId === 'restore-form') {
      if (data.get('approve') !== 'on') throw new Error('Confirm replacement first.');
      if (loadError) { saveState(localStorage, restore.next); state = restore.next; persisted = localStorage.getItem(STORAGE_KEY); loadError = ''; }
      else commit(restore.next);
      key = period(today(), state.payday).key; csv = null; preview = null; dialog.close(); render(); notify('Backup restored.');
    }
  } catch (e) {
    const el = form.querySelector('.form-error');
    if (el) el.textContent = e.message; else notify(e.message, true);
  }
});
window.addEventListener('storage', e => { if (e.key === STORAGE_KEY) notify('This ledger changed in another tab. Reload before editing.', true); });
render();
