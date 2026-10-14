# Billing & Payments implementation

## Financial contract

- One ROOM bill per booking; one CAPTAIN bill per restaurant order. Sources cannot be combined or rebound. A void bill still reserves its source; replacement/reissue is not implemented.
- Room charges use PostgreSQL `DATE` values from `booking_from`/`booking_to` and the booking's historical `room_rate`. These are calendar dates, not event timestamps; room nights equal the date difference. Same-calendar-day data yields zero nights, while negative or invalid dates are rejected.
- Room-service lines must have the same booking and hotel and source `room_qr`. Inconsistent relationships and invalid/missing lines are rejected rather than silently omitted. CAPTAIN bills use `captain` or `dining_table_qr` restaurant orders, never room orders.
- Persisted order-item unit price times quantity determines each charge. Current menu prices, room base prices, frontend totals, and legacy booking totals are not billing authority. Stored line subtotal disagreements require reconciliation.
- Every linked room-service order must be `completed` before room-bill finalization. `pending`, `preparing`, and `ready` block it. Finalization refreshes all eligible lines in the same transaction; source guards then reject later charges, financial edits, and deletion.
- Any nonzero legacy `room_booking.paid_amount` blocks creation and finalization with HTTP 409 `LEGACY_PAYMENT_RECONCILIATION_REQUIRED`. It is not imported, overwritten, or treated as a new ledger payment. No reconciliation workflow or automatic synchronization of legacy payment fields is provided.
- All calculations, including bill-list summaries, run on the backend using BigInt minor units. Values persist as Decimal(12,2) and travel as decimal strings. Percentage adjustments use integer-rational arithmetic and deterministic half-up currency rounding; proportional item allocations use largest remainder with line position as the stable tie-breaker.
- Tax and discount selection is manual, optional, and limited to one active same-hotel tax slab and one active same-hotel discount while the bill is DRAFT. The order is subtotal → discount → taxable subtotal → tax → total.
- The selected tax applies to the complete post-discount subtotal; free-text `tax_slab.applicable_on` is not calculation authority. `all` discounts use the full subtotal. Category/item discounts use resolved menu identifiers and exclude room accommodation.
- Minimum amount is evaluated against eligible subtotal. Percentage and fixed adjustments honor the maximum cap, and a fixed discount cannot exceed eligible subtotal.
- Draft recalculation revalidates the selected configurations and never substitutes another. Finalization freezes immutable tax/discount JSON snapshots and reconciled bill-item allocations. Later configuration edits/deletion cannot change finalized history.

## Persistence and transitions

Migrations: `20260906100000_billing_payments`, `20260912120000_tax_discount_billing`, `20260912123000_billing_adjustment_guards`, and `20260912124500_billing_snapshot_nulls` (applied to local `hms` through Prisma migrate deploy).

Models: `bill`, `bill_item`, `payment`. Bills persist `taxable_subtotal`, `tax_snapshot`, and `discount_snapshot`. Bill lines persist resolved menu/category identifiers, discount eligibility, and reconciled adjustment amounts. Existing zero-adjustment bills remain unchanged apart from the new derived taxable-subtotal field being initialized to their existing subtotal.

The billing catalog retains 3 primary keys, 6 foreign keys, 9 explicit CHECK constraints, 7 triggers, and the invoice sequence. PostgreSQL triggers/checks are maintained in migrations; Prisma schema introspection alone does not express them.

Lifecycle: DRAFT → FINALIZED → PARTIALLY_PAID → PAID. Full payment skips PARTIALLY_PAID. A zero-total finalized draft becomes PAID without fabricating a payment. Draft recalculation is explicit. DRAFT/FINALIZED may become VOID only without any payments. Paid/partially paid records cannot be reset to pending; no refunds.

Payments are positive Cash/UPI/Card receipts with status RECORDED, server-derived actor, timestamp, and optional transaction reference/notes. No gateway processing or raw card fields are implemented. Amount cannot exceed balance, and paid/void/draft bills cannot receive a new payment.

An `idempotency_key` UUID is required. Repeating the same request returns the existing result without another payment; changing details under the same key returns 409. The key is a request identifier, never an invoice or authentication token.

Invoice numbers use a global noncycling PostgreSQL sequence: `INV-000000000001`. Global uniqueness also guarantees hotel uniqueness. Concurrent sequence use is safe; rollback/crash gaps are intentional and numbers are never reclaimed. This is not a gapless jurisdiction-specific invoicing implementation.

Every financial mutation locks the hotel row and executes transactionally. Source-change triggers acquire the same lock, closing the create-order/finalize race. Payment insertion additionally locks the bill; a database trigger derives paid/balance/status from the immutable ledger in that transaction. This deliberately coarse hotel lock favors correctness over throughput. Separate-connection lock exclusion was verified; simultaneous payment HTTP load testing is not yet performed.

Finalized bill financial fields and lines cannot change; bill/payment deletion is rejected at the database. Source financial edits/deletion are blocked, while permitted Captain kitchen status progression can continue. Payments cannot be updated/deleted. Foreign keys preserve source relationships. Snapshots do not change when menu price or room base price changes.

## API

All paths below start with `/api/hotels/:hotelId`. Existing authentication → UUID validation → hotel scope → role authorization is applied per matching route. Only authenticated server context supplies the actor/hotel. Unrelated existing paths retain their existing middleware.

| Method | Path | Result |
|---|---|---|
| GET | `/bills` | `data.bills` and server-calculated `data.summary` |
| GET | `/bills/:billId` | Persisted receipt in `data.bill` |
| POST | `/room-bookings/:bookingId/bill` | Create ROOM draft, HTTP 201 |
| POST | `/orders/:orderId/bill` | Create CAPTAIN draft for a completed restaurant order, HTTP 201 |
| POST | `/bills/:billId/recalculate` | Refresh draft from persisted sources |
| POST | `/bills/:billId/finalize` | Refresh and lock snapshot |
| POST | `/bills/:billId/void` | Preserve unpaid void history |
| GET | `/bills/:billId/payments` | `data.payments` |
| POST | `/bills/:billId/payments` | Record payment, return updated `data.bill`, HTTP 201 |

Creation/recalculation/finalization/void accept an empty body only. Payment accepts only `amount`, `method`, `idempotency_key`, optional `reference`, and optional `notes`. No client-calculated tax/total/paid/balance or client actor/hotel is accepted. Mutations reuse trusted-origin protection.

Receipt response includes invoice, source reference, hotel/guest snapshots, quantities, historical unit prices, subtotal, selected-rule snapshots, discount, taxable subtotal, tax, grand total, payment history, balance/status, and audit timestamps. No password hashes or session tokens are returned.

Errors follow existing `{status:"error",error:{code,message}}`: invalid input 400, no/invalid cookie 401, role/hotel mismatch 403, missing source/bill 404, financial conflict 409. Billing trigger conflicts also surface as 409 through existing source APIs.

| Role | View/create/finalize/pay | Void |
|---|---|---|
| Admin | Room and Captain bills | Yes, unpaid only |
| Manager | Room and Captain bills | Yes, unpaid only |
| Reception | Room bills only, including direct-ID checks | No |
| Captain | No new financial administration access | No |
| Kitchen | No | No |

## Existing UI integration

- Manager Room Billing loads persisted ROOM invoices using AuthContext `user.hotelId`. Existing table/filter layout remains; filters/sort operate on live records. No create/finalize controls existed here, so these operations remain API-only rather than adding a new workflow.
- Reception Billing loads room bills and backend summary totals. Print fetches a fresh persisted receipt and renders all snapshot lines/payments (not a paginated partial receipt). Labels now correctly say Room instead of Table/restaurant, and amounts display two decimals.
- Existing payment action opens the shared modal for amount/method/reference, supports partial or full collection, blocks duplicate submissions, retains the request key for retry, reloads from PostgreSQL, and uses existing error/401 sign-out behavior. `Mark Pending` was removed because resetting financial history is unsupported.
- No layout/CSS redesign. Payment details and receipt financial fields were added only as required to represent the approved ledger accurately. No browser click-through validation was performed.
- Removed the unused Reception mock bill generator/status/storage functions. Manager persistence excludes `roomBills`. Old mock fixture files/browser keys are not consumed or migrated; they are not imported as financial records. Unrelated dashboard/mock modules remain out of scope.

## Verification and cleanup

`npm run test:billing` is a new explicit local-only integration test, not a startup seed. It uses real HTTP middleware, signed sessions backed by temporary PostgreSQL assignments, Prisma, and the actual local database. An outer transaction/savepoints ensure **all fixtures roll back**, including bills and payments; history guards are never disabled to clean up.

Verified: 48 HTTP/lock/numbering checks plus monetary, persistence, cleanup, and catalog assertions. Includes 401/tampered cookie; Captain/Kitchen 403; cross-hotel 403; UUID/missing bill errors; Admin/Manager/Reception permissions; duplicate bills; draft refresh; pending/preparing/ready finalization blocks; completed finalization; legacy reconciliation at creation and finalization; later room-order rejection through existing API; immutable bill/source/payment operations; historic prices; invalid/zero/negative/overprecision/over payments; partial/full payments; retry idempotency/key conflict; paid/void payment rejection; void-after-payment denial; room-only Reception list/detail; distinct invoice numbers from separate connections; independent writer lock rejection; health 200/database connected.

Before/after counts remained identical: hotel 1, users 6, roles 5, assignments 6, rooms 2, bookings 1, orders 2, order items 6, menu items 3, dining areas 2, tables 3, bills 0, bill items 0, payments 0. No permanent test records remain. Sequence gaps from tests remain by design. Negative guard tests intentionally emit Prisma error logs. Existing Prisma/pg execution emits a pg future-version concurrency deprecation warning; tests pass with installed dependencies.

`npm run check` and `npm run build --prefix client` pass. Vite reports the existing large-bundle warning. A stale port-4000 backend was restarted; the new billing route returns 401 (not 404) without authentication and health returns 200/connected.

Remaining validation: browser receipt/payment click-through and a multi-connection concurrent payment HTTP stress test. The rollback suite exercises real payment persistence within its transaction and independently proves the exclusion lock, but does not claim committed payment stress testing.

## Authored file inventory

Created:
- `prisma/migrations/20260906100000_billing_payments/migration.sql`
- `server/controllers/billingController.js`
- `server/routes/billingRoutes.js`
- `server/services/billingService.js`
- `server/tests/billing.integration.js`
- `server/BILLING.md`
- `client/src/features/billing/services/billingService.js`

Modified:
- `prisma/schema.prisma`
- `package.json` (billing syntax checks and explicit test script; no dependencies)
- `server/app.js` (billing router before overlapping room-booking middleware)
- `server/middleware/errorHandler.js` (financial guard conflicts)
- `client/src/features/manager/pages/ManagerDashboard.jsx`
- `client/src/features/manager/services/managerService.js`
- `client/src/features/reception/pages/Billing.jsx`
- `client/src/features/reception/services/receptionService.js`

Prisma Client was regenerated using `prisma generate`; generated output under `generated/prisma/` was not manually edited. Client production assets under `client/dist/` were regenerated by Vite. No packages were installed, authentication architecture changed, or existing migration edited.
