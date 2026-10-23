# Sative Kitchen

Daily deliveries, catalogue, café acceptance and payout tracking. The UI is served by Vercel and the database is a dedicated Supabase project. Costs are available to the supplier account only; server responses and report feeds for the manager omit them.

## Setup

Apply `db/schema.sql` to a dedicated Supabase project. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `KITCHEN_GATEWAY_KEY` (random 32+ byte secret), and `KITCHEN_REPORT_KEY` (a separate random secret) in Vercel. Store a SHA-256 hex digest of the gateway key in `kitchen.config` under `gateway_hash`. Seed `supplier` and `manager` in `kitchen.accounts` with `extensions.crypt(password,extensions.gen_salt('bf',10))`. Never put keys in the browser or repo. The owner can recover an account in the Supabase SQL editor using:

```sql
begin;
update kitchen.accounts
set password_hash=extensions.crypt('REPLACE_WITH_A_NEW_SECRET',extensions.gen_salt('bf',10)),version=version+1
where name='supplier'; -- or manager
delete from kitchen.sessions where account='supplier';
commit;
```

Use a temporary new password, sign in, and change it under Settings. Existing sessions are invalidated. Initial passwords are supplied privately to the account holders and must be changed after first use.

## Data and migration

`scripts/prepare-import.py` converts verified read-only exports of the two original Google workbooks into idempotent SQL. Source snapshots and generated SQL stay in ignored `.migration/`; never commit them. All 18 original tabs are preserved in `kitchen.source_archive`; oversized tabs are stored in ordered `part` records with `row_offset`. Import retains the recorded sell totals, item snapshots, historic flags, and source dates. Four reconciliation records flag ambiguous original values. Legacy `paid` flags are historical metadata, not new payment entries. The two imported `unpaid` flags are presented separately for manual reconciliation and do not enter new payout balances.

During transition, the original workbook tabs remain intact. The app becomes the source for new records. Report-only tabs in the two workbooks can import signed CSV endpoints `/api/report?type=products|deliveries|items|payouts&key=...` for automatic expansion without dragging formulas. Treat feed URLs as secrets; only share with people who already have access to the corresponding workbook. The report omits supplier costs. The café CRM remains a manual manager entry with a separate completion mark.

Each new delivery snapshots price, unit, quantity and optional cost. An archived product remains in historic deliveries. Payouts use flexible dates; changing assignment is blocked once either payout has a payment. Partial payments and idempotency keys prevent accidental duplicates. Manager acceptance, discrepancy and CRM marks are distinct. Report data is a read-only mirror, not a bidirectional edit target.
