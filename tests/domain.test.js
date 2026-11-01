import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as d from '../src/domain.js';
const tx = (id, overrides = {}) => ({ id, date: '2026-10-16', description: 'Example shop', accountId: 'personal', amount: -10000, type: 'purchase', share: 100, category: 'Groceries', refundOf: null, fundingReview: false, ...overrides });
const state = (...transactions) => ({ ...d.emptyState(), transactions });

test('payday inclusive start and exclusive next boundary with named month', () => {
  assert.equal(d.period('2026-10-14').key, '2026-09');
  assert.equal(d.period('2026-10-15').key, '2026-10');
  assert.equal(d.period('2026-11-14').key, '2026-10');
  assert.equal(d.period('2026-11-15').key, '2026-11');
  assert.equal(d.period('2027-01-14').key, '2026-12');
  assert.equal(d.period('2027-01-15').key, '2027-01');
  assert.equal(d.period('2026-10-15').end, '2026-11-15');
});
test('short months clamp each boundary independently, including leap years', () => {
  assert.equal(d.period('2026-02-27', 31).key, '2026-01');
  assert.equal(d.period('2026-02-28', 31).key, '2026-02');
  assert.equal(d.period('2026-03-30', 31).key, '2026-02');
  assert.equal(d.period('2026-03-31', 31).key, '2026-03');
  assert.equal(d.period('2028-02-29', 31).start, '2028-02-29');
  assert.equal(d.period('2026-01-01', 1).key, '2026-01');
  assert.throws(() => d.period('2026-01-01', 0));
});
test('strict dates and integer GBP normalization', () => {
  assert.equal(d.dateISO('31/10/2026'), '2026-10-31');
  assert.equal(d.dateISO('07 Oct 2026'), '2026-10-07');
  assert.equal(d.dateISO('7 October 2026'), '2026-10-07');
  assert.throws(() => d.dateISO('31/02/2026'));
  assert.throws(() => d.dateISO('10/31/2026'));
  assert.equal(d.pennies('£1,234.50'), 123450);
  assert.equal(d.pennies('(12.25)'), -1225);
  assert.equal(d.pennies('0.29'), 29);
  for (const bad of ['abc', '', '1.001', '1e4']) assert.throws(() => d.pennies(bad));
});
test('CSV quoted commas, escaped quotes, multiline, BOM and CRLF', () => {
  const csv = d.inspectCSV('\uFEFFDate,Description,Amount\r\n16/10/2026,"Shop, ""A""\nLondon",-2.50\r\n');
  assert.equal(csv.rows[0][1], 'Shop, "A"\nLondon');
  assert.throws(() => d.parseCSV('a,"bad'));
  assert.throws(() => d.parseCSV('a,"b"x'));
});
test('fictional Nationwide current debit/credit and preamble layout', () => {
  const csv = d.inspectCSV('Synthetic example\nDate,Description,Paid out,Paid in\n16/10/2026,Tesco,42.00,\n15/10/2026,Salary,,2000.00');
  const p = d.previewImport(d.emptyState(), csv, 'personal');
  assert.equal(p.errors.length, 0);
  assert.deepEqual(p.candidates.map(t => t.amount), [-4200, 200000]);
  assert.equal(p.candidates[1].type, 'unresolved-movement');
});
test('Nationwide card metadata and blank lines are skipped to find the transaction table automatically', () => {
  const csv = d.inspectCSV('\uFEFFAccount Name:,Example synthetic card\nAccount Number:,**** 1234\n\n\nTransaction Date,Card Number,Transaction Description,Amount,Payment Reference\n16/10/2026,**** 1234,"Home store,\nOxford",125.40,PMT-1\n17/10/2026,**** 1234,Payment received,-50.00,PMT-2');
  assert.equal(csv.headerLine, 5);
  assert.deepEqual(csv.headers, ['Transaction Date', 'Card Number', 'Transaction Description', 'Amount', 'Payment Reference']);
  assert.equal(csv.mapping.automatic, true);
  assert.equal(csv.mapping.reference, -1);
  assert.deepEqual(csv.rowLines, [6, 8]);
  const p = d.previewImport(d.emptyState(), csv, 'credit');
  assert.equal(p.errors.length, 0);
  assert.deepEqual(p.candidates.map(t => [t.date, t.description, t.amount]), [
    ['2026-10-16', 'Home store,\nOxford', -12540],
    ['2026-10-17', 'Payment received', 5000]
  ]);
});
test('realistic Nationwide transaction export structure uses account metadata, sterling paid columns and preserves legitimate repeats', async () => {
  const fixture = await readFile(new URL('../fixtures/nationwide-credit-card-metadata-synthetic.csv', import.meta.url), 'utf8');
  const csv = d.inspectCSV(fixture, { filename: 'statement.csv' });
  assert.equal(csv.headerLine, 5);
  assert.equal(csv.inferredAccountId, 'credit');
  assert.equal(csv.mapping.automatic, true);
  assert.equal(csv.mapping.reference, -1);
  let s = d.acceptImport(d.emptyState(), d.previewImport(d.emptyState(), csv, csv.inferredAccountId));
  assert.equal(s.transactions.length, 3);
  assert.deepEqual(s.transactions.map(t => [t.date, t.description, t.amount]), [
    ['2026-10-07', 'Example market', -350],
    ['2026-10-07', 'Example market', -350],
    ['2026-10-08', 'Example card payment', 5000]
  ]);
  const overlap = d.previewImport(s, csv, csv.inferredAccountId);
  assert.deepEqual(overlap.candidates.map(t => t.duplicate), [true, true, true]);
  assert.equal(d.acceptImport(s, overlap).transactions.length, 3);
  assert.equal(csv.metadata, undefined, 'account balance metadata is not copied into the import model');
  const cardPaidColumns = d.inspectCSV('Account Name:,Nationwide Credit Card\nDate,Transactions,Paid out,Paid in\n07 Oct 2026,Example purchase,£3.50,\n08 Oct 2026,Example credit,,£1.00');
  assert.deepEqual(d.previewImport(d.emptyState(), cardPaidColumns, 'credit').candidates.map(t => t.amount), [-350, 100]);
});
test('statement metadata identifies a card but never guesses current account ownership', () => {
  const current = d.inspectCSV('Account Name:,Nationwide FlexAccount\nDate,Transactions,Paid out,Paid in\n07 Oct 2026,Example shop,3.50,');
  assert.equal(current.inferredAccountId, null);
  const personal = d.inspectCSV('Account Name:,Nationwide Personal Current Account\nDate,Transactions,Paid out,Paid in\n07 Oct 2026,Example shop,3.50,');
  assert.equal(personal.inferredAccountId, 'personal');
  assert.equal(d.inspectCSV('Date,Transactions,Amount\n07 Oct 2026,Example shop,3.50', { filename: 'amex-statement.csv' }).inferredAccountId, 'amex');
});
test('recognizes common header variants but leaves uncertain amount/manual references for review', () => {
  const csv = d.inspectCSV('Account Name:,Synthetic\n\nDate of Transaction,Payee,Value,Payment Reference\n16/10/2026,Example shop,12.00,PAYMENT-1');
  assert.equal(csv.headerLine, 3);
  assert.equal(csv.mapping.date, 0);
  assert.equal(csv.mapping.description, 1);
  assert.equal(csv.mapping.reference, -1, 'payment reference must not be used as unique transaction ID');
  assert.equal(csv.mapping.automatic, false, 'unknown Value column requires explicit mapping');
  assert.throws(() => d.inspectCSV('Account Name:,Synthetic\nAccount Number:,**** 1234'), /Could not find a transaction header/);
});
test('row-level import errors point to physical CSV lines after preamble and quoted newlines', () => {
  const csv = d.inspectCSV('Account Name:,Synthetic\n\nDate,Description,Paid out,Paid in\n16/10/2026,"Cafe\nOxford",1,\n31/02/2026,Shop,4,');
  const p = d.previewImport(d.emptyState(), csv, 'personal');
  assert.deepEqual(csv.rowLines, [4, 6]);
  assert.deepEqual(p.errors.map(e => e.row), [6]);
});
test('fictional card provider conventions, credits, signed override, mapping', () => {
  const csv = d.inspectCSV('Date,Description,Amount\n16/10/2026,Shop,100\n17/10/2026,Refund,-20');
  for (const account of ['amex', 'credit']) assert.deepEqual(d.previewImport(d.emptyState(), csv, account).candidates.map(t => t.amount), [-10000, 2000]);
  assert.deepEqual(d.previewImport(d.emptyState(), csv, 'personal').candidates.map(t => t.amount), [10000, -2000]);
  assert.deepEqual(d.previewImport(d.emptyState(), csv, 'amex', csv.mapping, 'in-positive').candidates.map(t => t.amount), [10000, -2000]);
  const custom = d.inspectCSV('When,Who,Value\n16/10/2026,Shop,10');
  assert.equal(custom.mapping.automatic, false);
  assert.throws(() => d.previewImport(d.emptyState(), custom, 'personal'));
  assert.equal(d.previewImport(d.emptyState(), custom, 'personal', { date: 0, description: 1, amount: 2, debit: -1, credit: -1, reference: -1 }, 'out-positive').candidates[0].amount, -1000);
});
test('errors report row numbers and prevent partial commit', () => {
  const p = d.previewImport(d.emptyState(), d.inspectCSV('Date,Description,Paid out,Paid in\n31/02/2026,Shop,1,\n16/10/2026,Shop,1,2\n17/10/2026,Shop,0,\n18/10/2026,Shop,1'), 'joint');
  assert.deepEqual(p.errors.map(e => e.row), [2, 3, 4, 5]);
  assert.throws(() => d.acceptImport(d.emptyState(), p));
});
test('overlap import is idempotent without collapsing identical occurrences', () => {
  const csv = d.inspectCSV('Date,Description,Amount\n16/10/2026,Cafe,-4\n16/10/2026,Cafe,-4\n17/10/2026,Other,-4');
  let s = d.acceptImport(d.emptyState(), d.previewImport(d.emptyState(), csv, 'personal'));
  assert.equal(s.transactions.length, 3);
  const repeated = d.previewImport(s, csv, 'personal');
  assert.equal(repeated.candidates.filter(t => t.duplicate).length, 3);
  s = d.acceptImport(s, repeated); assert.equal(s.transactions.length, 3);
  const extra = d.inspectCSV('Date,Description,Amount\n16/10/2026,Cafe,-4\n16/10/2026,Cafe,-4\n16/10/2026,Cafe,-4');
  assert.equal(d.acceptImport(s, d.previewImport(s, extra, 'personal')).transactions.length, 4);
  assert.equal(d.acceptImport(s, d.previewImport(s, csv, 'joint')).transactions.length, 6);
  assert.equal(repeated.ambiguous, true);
});
test('provider IDs preserve distinct purchases and reject conflicting references', () => {
  const csv = d.inspectCSV('Date,Description,Amount,Transaction ID\n16/10/2026,Cafe,-4,A\n16/10/2026,Cafe,-4,B');
  const s = d.acceptImport(d.emptyState(), d.previewImport(d.emptyState(), csv, 'personal'));
  assert.equal(s.transactions.length, 2);
  assert.equal(d.previewImport(s, csv, 'personal').ambiguous, false);
  const conflict = d.inspectCSV('Date,Description,Amount,Transaction ID\n16/10/2026,Cafe,-5,A');
  assert.equal(d.previewImport(s, conflict, 'personal').errors.length, 1);
});
test('learning is transparent, exact, opt-in and corrections are one-off', () => {
  let s = state(tx('a', { share: null }), tx('b', { description: 'Unknown', share: null }));
  s = d.confirmTransaction(s, 'a', { share: 100, category: 'Groceries' });
  assert.equal(s.rules.length, 0);
  assert.equal(d.suggestion(s, 'example SHOP').confidence, 'History suggestion');
  s = d.confirmTransaction(s, 'a', { share: 100, category: 'Groceries' }, true);
  assert.equal(d.suggestion(s, 'example shop').confidence, 'Rule match');
  s = d.confirmTransaction(s, 'a', { share: 0 });
  assert.equal(s.rules[0].share, 100);
  assert.equal(d.suggestion(s, 'Example shop branch').share, null);
  assert.equal(d.suggestion(state(tx('a'), tx('b', { share: 0 })), 'Example shop').share, null);
});
test('splits and linked later refunds stay in original spending period', () => {
  const s = state(tx('a', { share: 60 }), tx('r', { date: '2026-11-20', amount: 2000, type: 'refund', share: null, refundOf: 'a' }));
  assert.deepEqual(d.expense(s, s.transactions[0]), { personal: 3200, household: 4800, funded: 4800, paid: 0, due: 4800 });
  assert.equal(d.summary(s, '2026-10').household, 4800);
  assert.equal(d.summary(s, '2026-11').household, 0);
  assert.throws(() => d.confirmTransaction(s, 'r', { amount: 20000 }));
  assert.throws(() => d.confirmTransaction(s, 'r', { accountId: 'amex' }));
});
test('joint purchases create household spending, never personal reimbursement', () => {
  const s = state(tx('a', { accountId: 'joint' }));
  assert.equal(d.expense(s, s.transactions[0]).household, 10000);
  assert.equal(d.expense(s, s.transactions[0]).due, 0);
  assert.throws(() => d.addReimbursement(s, { date: '2026-11-15', allocations: [{ transactionId: 'a', amount: 100 }] }));
});
test('income, repayments and transfers do not count as purchases; joint card funding stays unresolved', () => {
  const s = state(tx('a', { amount: 100000, type: 'income', share: null }), tx('b', { type: 'card-payment', share: null }), tx('c', { type: 'transfer', share: null }), tx('d', { type: 'card-payment', accountId: 'joint', share: null, fundingReview: true }));
  assert.equal(d.summary(s, '2026-10').household, 0);
  assert.equal(d.summary(s, '2026-10').review, 1);
  assert.throws(() => d.confirmTransaction(s, 'd', { fundingReview: false }));
});
test('manual reimbursements allocate once; imported two-sided matching does not deduct twice', () => {
  let s = state(tx('a'), tx('in', { type: 'unresolved-movement', amount: 4000, share: null }), tx('out', { type: 'transfer', amount: -4000, accountId: 'joint', share: null }));
  s = d.addReimbursement(s, { date: '2026-11-15', allocations: [{ transactionId: 'a', amount: 4000 }] });
  const id = s.reimbursements[0].id;
  s = d.reconcile(s, id, 'in'); s = d.reconcile(s, id, 'out');
  assert.equal(d.expense(s, s.transactions[0]).due, 6000);
  assert.equal(d.summary(s, '2026-10').paid, 4000);
  assert.throws(() => d.reconcile(s, id, 'in'));
  assert.throws(() => d.addReimbursement(s, { date: '2026-11-15', allocations: [{ transactionId: 'a', amount: 6001 }] }));
  assert.throws(() => d.addReimbursement(s, { date: '2026-11-15', allocations: [{ transactionId: 'a', amount: 100 }, { transactionId: 'a', amount: 100 }] }));
});
test('late refund after settlement exposes credit rather than clamping or moving spend', () => {
  let s = state(tx('a'));
  s = d.addReimbursement(s, { date: '2026-11-15', allocations: [{ transactionId: 'a', amount: 10000 }] });
  s.transactions.push(tx('r', { date: '2026-12-01', type: 'refund', amount: 2000, share: null, refundOf: 'a' }));
  assert.equal(d.expense(s, s.transactions[0]).due, -2000);
  assert.equal(d.summary(s, '2026-12').priorDue, -2000);
});
test('current period is incomplete, prior unsettled and review are separated', () => {
  const s = state(tx('a', { date: '2026-09-20' }), tx('b', { share: null }));
  const v = d.summary(s, '2026-10', '2026-10-31');
  assert.equal(v.priorDue, 10000); assert.equal(v.due, 0); assert.equal(v.review, 1); assert.equal(v.incomplete, true);
  assert.equal(d.summary(s, '2026-10', '2026-11-15').incomplete, false);
});
test('backup/persistence roundtrip validates schemas and preserves allocations/rules', () => {
  let s = d.demoState();
  s = d.confirmTransaction(s, 'demo-0', { share: 100 }, true);
  assert.deepEqual(d.importBackup(d.exportBackup(s)), s);
  const map = new Map(), storage = { setItem: (k, v) => map.set(k, v), getItem: k => map.get(k) };
  d.saveState(storage, s); assert.deepEqual(d.loadState(storage), s);
  assert.deepEqual(d.loadState({ getItem: () => null }), d.emptyState());
  assert.throws(() => d.importBackup('{"version": 99}'));
  assert.throws(() => d.importBackup(d.exportBackup(s).replace('"ownership": "joint"', '"ownership": "personal"')));
  const bad = structuredClone(s); bad.transactions.push(bad.transactions[0]);
  assert.throws(() => d.validateState(bad));
  assert.throws(() => d.saveState({ setItem: () => { throw new Error('Quota exceeded'); } }, s), /Quota/);
  const overpaid = structuredClone(s); overpaid.reimbursements[0].allocations[0].amount = 1000000;
  assert.throws(() => d.validateState(overpaid), /gross purchase/);
});
