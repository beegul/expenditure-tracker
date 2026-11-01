# Commonplace · expenditure tracker

A local-first personal and household expenditure ledger. Not a budgeting app: there are no targets, allowances or remaining budgets.

## Run locally

Requires Node.js 20 or newer. The app itself has **no runtime dependencies**, backend or cloud account.

```powershell
npm start
```

Open **http://127.0.0.1:5173** in a modern browser. Keep using this exact address: browser storage belongs to an origin. `localhost`, a different port or another browser has a separate dataset.

For a static-site build, run `npm run build`; publish the contents of `dist` using any static host. Data still stays in that browser. Use HTTPS for a remotely hosted copy. Hosting is optional; this repository does not deploy anything.

For automated checks:

```powershell
npm ci
npm run check
npx playwright install chromium
npm run test:browser
```

`npm run check` covers syntax, domain tests and the production build. Browser tests cover working workflows and mobile overflow. Tests use fictional data only.

## Start with your own ledger

The first run is empty. In **Data & settings**, give the four sources helpful display names and confirm payday (15 by default):

- Nationwide personal current account
- Nationwide joint current account
- Nationwide personal credit card
- American Express personal card

Ownership is fixed to prevent accidentally treating joint-paid spending as personally funded. No account numbers or credentials are needed. **Explore fictional demo** is a separate in-memory dataset: it never merges into your ledger or persists when the page reloads.

## Import & review

Choose **Import statements**, select the actual account and a CSV file. Familiar date, description and amount columns are detected automatically; Nationwide account metadata and blank lines above the transaction table are skipped. The preview opens as soon as the columns are confidently recognised. Use **Adjust detected columns** if needed; unfamiliar or ambiguous layouts show the manual mapping fallback. Check date, amount direction, account and duplicates against the source statement. Every row error must be fixed before import; there is no silently skipped partial import.

Supported layouts are deliberately explicit:

| Layout | Columns | Amount direction |
|---|---|---|
| Nationwide current | `Date, Description, Paid out, Paid in` | Paid out and paid in positive; one populated per row |
| Nationwide current signed | `Date, Description, Amount` | Negative debit, positive credit |
| Nationwide credit / Amex | `Date, Description, Amount` | Positive purchase charge, negative credit |
| Custom CSV | Map date, description, signed amount or debit/credit, optional genuine unique ID | Choose credits-positive or charges-positive explicitly |

Aliases include Transaction Date, Date of Transaction, Posted Date, Transaction Description, Transaction Details, Details, Merchant, Payee, Narrative, Debit, Credit, Money Out and Money In. Amount takes priority over debit/credit if both are mapped. Only explicitly named transaction IDs are recognised; a payment reference is never assumed unique. The parser accepts comma-separated UTF-8/BOM CSV, quoted fields, escaped quotes, CRLF and multiline descriptions; dates are `DD/MM/YYYY`, `DD-MM-YYYY` or `YYYY-MM-DD`. GBP values permit two decimal places, commas, a pound symbol and parentheses for negative amounts. Zero-amount rows need investigation. A recognised header may follow statement preamble rows.

**No real bank CSV samples have been supplied or verified.** These layouts are tested with representative **synthetic** fixtures in `fixtures`. Check real exports before importing. For Excel or OFX statements, export CSV; neither Excel nor OFX is supported in v1. No historical workbook matching is attempted.

Overlapping imports use a genuine unique transaction ID when mapped. Otherwise they use account + date + normalised exact description + amount + occurrence count. Two identical purchases in one file remain two purchases. Reimporting the same file adds none. **An incomplete overlapping file without unique IDs cannot prove whether an identical row is old or genuinely new**: inspect skipped rows and explicitly choose “Keep as genuinely new” if needed. A repeated payment reference is not a unique ID. Conflicting unique IDs are reported as errors. Manual entries have no bank identity and cannot be automatically deduplicated against later imports.

Purchases initially need classification. Credits and descriptions mentioning payments/transfers/refunds/income remain unresolved cash movements. These are hints, not authoritative bank-type detection. Use the **Review queue** to explicitly choose:

- Purchase: personal, household or a partly-household percentage, plus category.
- Refund: link its original purchase on the same account.
- Income, card repayment or own-account transfer: cash movement, not purchase spending.
- Reimbursement: link it to an allocated reimbursement record.

Suggestions are transparent local exact-merchant history or explicit rules, not ML. Confirmed consistent history suggests a share/category; conflicting history remains ambiguous. **Edits are one-off** unless “Remember for this exact merchant” is checked. Starbucks personal and Tesco household appear only as fictional examples, never built-in rules. All suggestions require confirmation. Remove remembered rules in settings.

## Periods & spending

October with payday 15 means **15 October through 14 November**, settled on **15 November**. A transaction on 15 November belongs to November. Named YTD starts at January's payday: 1–14 January belongs to the previous December. Configurable days 1–31 clamp each monthly boundary independently to that month's last day, including leap years. Changing payday regroupes purchases while keeping settlement allocations attached.

**Monthly ledger** shows personal spending, all household spending regardless of paying account, personally funded household share, remaining owed this period, prior outstanding/credits separately, and unresolved counts. Income, transfers and card repayments never add to spending. The ledger's money-in/out column is signed cash movement, not net expenditure. Linked refunds reduce original purchase spending and household share even when received in a later period.

**Year & comparison** shows named-period YTD, personal/household distribution and completed-period changes. Current periods are labelled partial and never compared as full months. Missing recorded periods are not assumed to represent complete bank history; import completeness cannot be verified automatically.

## Reimbursements

Classification and reimbursement are independent. A joint-paid purchase contributes to total household spending but creates **no personally funded reimbursement entitlement**. A personal/card purchase earns only its household percentage, less attributable refunds.

In **Reimbursements**, record an actual reimbursement already received and allocate it to eligible purchases; partial allocations are supported. Purchases remain in their original spending period. When the corresponding bank transfer is imported, explicitly link the exact-amount personal-current credit and/or joint debit to **the same record**. Linking never deducts twice. Matching dates and descriptions are displayed for your own confirmation, not guessed. Undoing a record removes allocations and sends linked movements back to review.

Joint-funded card repayments remain prominently in review. v1 does not infer which purchases a joint card payment funded. If it was actually a household reimbursement, record explicit eligible allocations and classify/link the joint debit as reimbursement; otherwise leave funding unresolved. Never classify an entire card repayment as a purchase. No bank transfers are automated.

Settlement is provisional while relevant transactions remain unresolved. A later refund or correction after reimbursement may expose a negative amount due (household credit); it is not clamped to zero. **Credits owed back to the joint account require manual resolution outside v1**; export the record and account for the return separately. The app does not automate return payments or offset credits invisibly against different expenses.

## Privacy & backup

Financial data, rules and reimbursement records are stored in browser local storage. There is no analytics, remote AI, external font, API or transaction upload. A Content Security Policy blocks outbound connections and external scripts. The repository and tests contain only synthetic fixtures.

Export JSON backups regularly using **Data & settings** or the sidebar. A validated restore **replaces**, rather than merges, the dataset and requires explicit confirmation. Corrupt stored data is preserved for download instead of silently replaced. Failed writes and concurrent-tab conflicts are reported; reload before editing after another tab changes the data.

Backups contain financial data in **plain text**. Storage is not encrypted, and anyone with access to your browser profile/device can read it. Keep your device secure, do not use a shared browser profile, and store backups in a secure location. Clearing browser data or private browsing can lose data. **Never commit real statements, backups, account numbers, spreadsheets, attachments or credentials to this public repository.**

## v1 scope

GBP only; four fixed account sources; exact merchant matching; one category and a whole-number household percentage per purchase; same-account linked refunds; explicit exact-amount bank-transfer reconciliation. No Open Banking, bank credentials, cloud sync, automatic payments, Excel/OFX import, automatic workbook matching, encrypted storage or claim of bank-export certification. A browser must already have the app loaded to continue using it without network; there is no offline reload/service-worker installation.
