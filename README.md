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

## Live architecture

The application and Supabase are the only operational system. Google Sheets is disconnected. No Sheets credentials, formulas, scheduled sync, or export feeds are used. The old workbooks remain historical reference files. Temporary app report tabs were removed. Both old HTTP endpoints return 410; the database no longer has an unauthenticated report action.

## Mobile and installation

The responsive UI uses compact bottom navigation on phones and a centred desktop layout. The delivery form has a search field and a persistent total/save bar. The web app manifest and Apple metadata support Add to Home Screen. Install from Safari's Share menu. The first standalone launch may require signing in once because the OS can use a separate cookie store. Subsequent launches reuse a protected HttpOnly cookie; sessions expire after 90 days without activity and renew during use. Password changes revoke other sessions.

The service worker stores only public static assets. It never caches API responses, passwords, costs or delivery records. Writes require an internet connection; an offline screen avoids implying that a delivery was saved.

Each new delivery snapshots price, unit, quantity and optional cost. An archived product remains in historic deliveries. Payout and delivery dates are independent. Both roles can create, edit, split and remove deliveries at any date, including after payment. Payments are independent of acceptance and CRM processing; prepayments become an advance. Partial payments, optimistic versions and idempotency keys protect against accidental duplicates or stale edits. Manager acceptance, discrepancy and CRM marks are distinct. Editing delivery contents or its delivery date resets acceptance and CRM confirmation for review. Changing only payout assignment keeps them. Deleted entries are excluded from state and totals, with before snapshots in the private audit log for recovery; payments never cascade-delete with deliveries.

## Flexible ledger update

Apply `db/flexible-ledger.sql` after the base schema. It adds version/deletion metadata, an internal invoker-only ledger helper, and patches the existing gateway/session dispatcher. `tests/ledger.sql` is a database integration test and must be wrapped in `BEGIN` / `ROLLBACK`; it never belongs in production initialization. Run `npm test` for API, period and payout calculations.

Payouts group active app deliveries and active payments by payout date, newest first. Payment-only groups retain unassigned advances. Historical imported totals stay separate from the current ledger to avoid counting old paid flags as cash movements. A transfer reassigns existing money (splitting a payment record if necessary) while preserving the total received, original date and actor. Audit records identify who performed edits/transfers. Original supplier costs remain private in manager responses, including after edits.

Both roles access delivery changes through the card's Actions disclosure. Existing item price/unit/cost snapshots are retained unless a supply price/quantity is explicitly edited; new catalogue items take their current snapshots. New payments and payment corrections use the same field and button scale. Closed payout cards are collapsed by default; filters affect presentation only.
