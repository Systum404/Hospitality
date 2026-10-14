# AAZIRA HMS Settings Contract

## 1. Executive Summary

This document defines the approved future Settings contract for hotel-scoped administration. It is a contract only; it does not authorize or implement source, API, schema, migration, or runtime-data changes.

The existing Admin and Manager Settings pages are not authoritative. They persist hardcoded/mock values in browser `localStorage`, are not scoped by hotel or user, and have no backend consumers. Future Settings must remove that behavior and use existing authoritative models wherever possible.

The approved direction is:

- `HOTEL_ADMIN` is the only hotel role permitted to edit hotel metadata through Settings.
- Billing requires hotel-scoped service-charge configuration and a hotel-scoped default tax.
- All billing remains exact to two decimal places; nearest-rupee rounding and configurable rounding are prohibited.
- Default tax must preserve the existing explicit DRAFT-bill tax-selection architecture.
- Auto-print, currency configuration, and customer-facing tax-registration display are not Settings features.
- `HOTEL_ADMIN` and `MANAGER` do not share an undifferentiated Settings contract.

Existing `hotel` and `tax_slab` records remain authoritative. A generic key/value Settings table is rejected. A narrowly typed, one-to-one hotel billing configuration is justified for service charge and default tax, subject to the unresolved company decisions in section 13.

## 2. Approved Company Decisions

| Decision | Contract consequence |
|---|---|
| Hotel information is editable only by `HOTEL_ADMIN` | Add a hotel-scoped metadata read/update contract for `HOTEL_ADMIN`; do not retain editable browser copies. Company/Super Admin metadata editing must not remain a competing mutation path for fields delegated to `HOTEL_ADMIN`. |
| Service charge is required | Add authoritative hotel-scoped enabled/rate configuration and bill snapshot support. Exact calculation semantics remain blocked on section 13 decisions. |
| Billing stays at exactly two decimals | Preserve Decimal/minor-unit arithmetic and deterministic half-up rounding to currency precision. Remove Round Off from both Settings pages. |
| Default tax is required | Persist a same-hotel `tax_slab` reference and use it as a preselection for newly created DRAFT bills. |
| Auto-print is not required | Remove the control and do not add persistence or automatic printing. Explicit user-triggered printing remains unchanged. |
| Currency code is not a Settings feature | Remove the Settings control. Preserve existing `hotel.currency_code` metadata outside Settings; do not add FX or conversion behavior. |
| Tax registration must not appear on customer bills/receipts | Keep `hotel.tax_registration_number` out of customer billing projection, receipt UI, and PDF. |
| `HOTEL_ADMIN` and `MANAGER` have different permissions | Use the matrices in sections 6 and 7; unresolved financial-setting ownership remains explicit. |

## 3. Service Charge Contract

### 3.1 Confirmed contract

| Topic | Contract |
|---|---|
| Scope | Hotel-scoped authoritative configuration. Never browser-local and never client-controlled during calculation. |
| Configuration | `enabled: Boolean` plus `percentage: Decimal(5,2)` (or an equivalent exact decimal representation). When enabled, percentage must be greater than `0.00` and at most `100.00`; at most two decimal places. Disabled configuration may retain the last valid percentage but contributes `0.00`. |
| Calculation authority | Backend billing service only. Clients submit no service-charge amount, base, total, or snapshot. |
| Precision | Convert the configured percentage and chosen base to minor units and use the existing deterministic half-up method. Persist exactly two decimals. No nearest-rupee step. |
| Bill persistence | Add a bill-wide `service_charge_amount Decimal(12,2)` with a zero default for historical compatibility, plus a nullable immutable `service_charge_snapshot Json`. |
| Snapshot contents | Configuration identity/version or stable setting identity, enabled state, configured rate, chosen base identifier, base amount, calculated amount, taxable flag, and rounding marker (`HALF_UP_2DP`). Do not include secrets or mutable display-only state. |
| DRAFT creation | Resolve configuration server-side while holding the existing hotel billing lock. Create the DRAFT with the then-current charge and snapshot. |
| DRAFT recalculation | A settings update does not bulk-rewrite existing DRAFT bills. The next explicit recalculate or finalization refreshes the DRAFT from current authoritative sources and current service-charge configuration in the existing transaction. |
| Finalization | Finalization performs the existing authoritative refresh, then freezes the service-charge amount and snapshot with all other financial fields. |
| Financial commitment | FINALIZED, PARTIALLY_PAID, PAID, and VOID historical bills are never recalculated because of a later Settings change. |
| Customer presentation | When nonzero, expose the snapshotted service charge as a separate bill-summary row in staff receipts, customer billing projection, and customer PDF so the persisted total is explainable. Do not add tax registration. |
| Reports | Existing Manager and Hotel Admin report definitions remain unchanged. Service charge flows into persisted bill totals, balances, and recorded collections; it is not added to item/category subtotals or top-item sales. |
| Concurrency | Settings mutations and billing creation/recalculation/finalization must lock the same hotel row before reading configuration or writing financial state. |

### 3.2 Unresolved service-charge rules

| Question | Status | Why unresolved |
|---|---|---|
| Applies to restaurant bills, room bills, or both? | **REQUIRES COMPANY DECISION** | Current billing supports ROOM and CAPTAIN bills but has no service-charge rule from which scope can be inferred. |
| Base is subtotal before discount, subtotal after discount, or another amount? | **REQUIRES COMPANY DECISION** | Existing billing defines subtotal, discount, and taxable subtotal but no service-charge ordering. |
| Is service charge taxable? | **REQUIRES COMPANY DECISION** | This changes the tax base and must not be inferred. |
| Do discounts reduce the service-charge base? | **REQUIRES COMPANY DECISION** | Depends on the approved base/order of operations. |
| Who may update enabled/rate: only `HOTEL_ADMIN`, only `MANAGER`, or both? | **REQUIRES COMPANY DECISION** | The company confirmed different role permissions but did not allocate this financial authority. |

Until these decisions are approved, no production calculation or migration backfill value can be implemented safely.

## 4. Default Tax Contract

### 4.1 Confirmed contract preserving current architecture

| Topic | Contract |
|---|---|
| Meaning | The default is a server-resolved preselected `tax_slab` for a newly created DRAFT bill. It is not an irreversible automatic tax and is not customer-side authority. |
| Scope | One nullable same-hotel tax-slab reference in authoritative hotel billing configuration. “Nullable” is required for migration/bootstrap sequencing; the product may treat absence as an incomplete configuration. |
| Explicit selection | If an authorized bill-creation request explicitly provides a tax selection, that selection wins after existing same-hotel/active validation. Otherwise the server resolves the configured default. |
| Staff control | While a bill remains DRAFT, authorized staff retain the existing ability to change or remove the selected tax and explicitly recalculate. |
| Snapshot | The selected slab continues to be copied into `bill.tax_snapshot`; the finalized snapshot remains immutable. The settings record is never consulted to render historical tax. |
| Existing DRAFT bills | Changing the default does not mutate or silently reselect tax on existing DRAFT bills. Their selected tax remains as persisted unless authorized staff explicitly change it. |
| Finalized history | Default changes never affect FINALIZED, PARTIALLY_PAID, PAID, or VOID bills. |
| Cross-hotel integrity | The configured tax slab must belong to the same hotel. Enforce this with a composite database relationship and service validation, not frontend filtering. |
| Substitution | Never silently substitute another active slab if the configured slab is missing or inactive. |

### 4.2 Default-tax failure policies

| Question | Status | Required choice |
|---|---|---|
| If no default is configured, may staff create an untaxed DRAFT, or must bill creation be blocked? | **REQUIRES COMPANY DECISION** | Company said default tax is required but did not define rollout/bootstrap or failure behavior. |
| May a default slab be deactivated/deleted? | **REQUIRES COMPANY DECISION** | Choose: reject the tax mutation while referenced, or clear the default and mark hotel billing configuration incomplete. Silent fallback is prohibited. |
| Who may update the default: only `HOTEL_ADMIN`, only `MANAGER`, or both? | **REQUIRES COMPANY DECISION** | Existing tax-slab APIs permit both roles, but default-setting authority was not assigned. |

## 5. Hotel Metadata Ownership

Existing `hotel` columns remain the sole source of truth. Settings must never copy them into a separate Settings record.

### A. Editable by `HOTEL_ADMIN`

These are existing metadata fields and can use the current validation semantics after being exposed through a hotel-scoped `HOTEL_ADMIN` endpoint:

| API field | Prisma field | Notes |
|---|---|---|
| `name` | `hotel.name` | Required, trimmed, max 255. |
| `type` | `hotel.type` | Required under current hotel metadata validation, max 50. |
| `address_line` | `hotel.address` | Required, max 2000. |
| `city` | `hotel.city` | Required, max 100. |
| `state_province` | `hotel.state_province` | Required, max 100. |
| `country` | `hotel.country` | Required, max 100. |
| `postal_code` | `hotel.postal_code` | Required, max 20. |
| `phone` | `hotel.phone` | Required, current phone validation. |
| `official_email` | `hotel.email` | Required, normalized email validation. |
| `timezone` | `hotel.timezone` | Required valid IANA timezone; operationally significant. |
| `logo_url` | `hotel.logo_url` | Optional HTTP(S) URL. |
| `website` | `hotel.website` | Optional HTTP(S) URL. |
| `tax_registration_number` | `hotel.tax_registration_number` | Optional internal hotel metadata; never projected to customer bills/receipts. |
| `description` | `hotel.description` | Optional, max 5000. |
| `check_in_time` | `hotel.check_in_time` | Optional 24-hour `HH:mm`. |
| `check_out_time` | `hotel.check_out_time` | Optional 24-hour `HH:mm`. |

### B. Read-only for `HOTEL_ADMIN`

| Field | Reason |
|---|---|
| `code` | Generated stable hotel identifier. |
| `status` | Lifecycle state, not metadata editing. |
| `created_at`, `updated_at` | Server-owned audit timestamps. |
| `room_count` | Derived data. |
| `currency_code` | Existing metadata retained outside Settings; company explicitly excluded currency configuration from Settings. |

### C. Company/SUPER_ADMIN controlled

| Capability/field | Contract |
|---|---|
| Hotel creation | Remains company-scoped. |
| Hotel activation/deactivation | Remains company-scoped lifecycle control. |
| Generated hotel code | Remains server/company controlled. |
| Currency metadata | Remains outside hotel Settings; no financial conversion behavior is introduced. |

To satisfy “hotel information can be edited only by `HOTEL_ADMIN`,” the future Super Admin Hotel UI/API must not remain a competing metadata-mutation path for the fields listed in section A. Company lifecycle and creation remain separate.

### D. Not exposed in Settings

- Internal hotel UUID.
- Latitude/longitude (present in the schema but not in the current company metadata contract).
- Lifecycle controls.
- Currency configuration.
- Room count and other derived operational totals.
- Audit-event internals.
- Tax registration on customer-facing documents.

## 6. HOTEL_ADMIN Permission Matrix

| Area | Permission in future Settings | Basis |
|---|---|---|
| Hotel metadata in section 5A | Read and update own hotel | Approved company decision. |
| Hotel code/status/timestamps/currency | Read-only where useful; no Settings mutation | Generated/lifecycle/company-controlled or explicitly excluded. |
| Service charge enabled/rate | **REQUIRES COMPANY DECISION** | Financial-setting owner not assigned. |
| Default tax | **REQUIRES COMPANY DECISION** | Financial-setting owner not assigned. |
| Tax slabs | Existing hotel-scoped CRUD remains outside Settings | Current API authorizes `HOTEL_ADMIN` and `MANAGER`. |
| Discounts | Existing hotel-scoped CRUD remains outside Settings | Current API authorizes `HOTEL_ADMIN` and `MANAGER`. |
| Billing lifecycle/payments | Preserve existing billing permissions; no new Settings authority | Existing billing contract. |
| Reports | Existing read-only Hotel Admin Reports | No Settings mutation. |
| Inventory/menu/vendors | Existing operational modules | Not Settings. |
| Notifications | Existing self-scoped list/read operations | No notification-preference contract exists. |
| Auto print, round off, currency | No control | Explicitly removed/excluded. |
| Personal UI preferences | Browser-local only when a real consumer exists | Must not be presented as hotel configuration. |

## 7. MANAGER Permission Matrix

| Area | Permission in future Settings | Basis |
|---|---|---|
| Hotel identity/contact/tax metadata | No edit; read-only only where another workflow requires it | Company assigned editing only to `HOTEL_ADMIN`. |
| Hotel lifecycle/code/currency | No Settings mutation | Company/lifecycle controlled or excluded. |
| Service charge enabled/rate | **REQUIRES COMPANY DECISION** | Manager financial-setting authority was not approved. |
| Default tax | **REQUIRES COMPANY DECISION** | Manager default-setting authority was not approved. |
| Tax slabs | Existing hotel-scoped CRUD remains outside Settings | Existing API currently authorizes Manager. |
| Discounts | Existing hotel-scoped CRUD remains outside Settings | Existing API currently authorizes Manager. |
| Billing lifecycle/payments | Preserve existing Manager billing permissions | Not a Settings preference. |
| Reports | Existing read-only Manager Reports | Not Settings. |
| Inventory/menu/vendors | Preserve existing operational management | Not Settings. |
| Notifications | Existing self-scoped list/read operations | No notification-preference contract exists. |
| Auto print, round off, currency | No control | Explicitly removed/excluded. |
| Workspace/UI preferences | May remain user/device-local only when functional and clearly labelled personal | Must not change hotel or financial state. |

## 8. Settings-to-Existing-Model Mapping

| Future concept | Authoritative model/location | New persistence? | Notes |
|---|---|---|---|
| Hotel name/contact/address/timezone/etc. | Existing `hotel` columns | No | Add only hotel-scoped `HOTEL_ADMIN` access; do not duplicate data. |
| Tax slab catalog | Existing `tax_slab` | No | Existing active/same-hotel rules remain. |
| Default tax | Proposed `hotel_billing_settings.default_tax_slab_id` | Yes | Same-hotel FK to existing `tax_slab`; server-resolved preselection. |
| Service charge enabled | Proposed `hotel_billing_settings.service_charge_enabled` | Yes | Boolean, hotel-scoped. |
| Service charge percentage | Proposed `hotel_billing_settings.service_charge_rate` | Yes | Exact Decimal(5,2); validation in section 3. |
| Calculated service charge | Proposed `bill.service_charge_amount` | Yes | Decimal(12,2), zero for historical bills. |
| Historical service-charge rule | Proposed `bill.service_charge_snapshot` | Yes | Immutable after financial commitment. |
| Selected tax history | Existing `bill.tax_snapshot` | No | Continue using current snapshot contract. |
| Auto print | None | No | Removed. |
| Round Off | None | No | Removed; exact two decimals remain mandatory. |
| Currency Settings | None | No | Existing `hotel.currency_code` remains outside Settings. |

## 9. Settings That Must Be Removed

| Current UI element/behavior | Required disposition |
|---|---|
| Admin and Manager Auto Print Receipt | Remove; no replacement setting. Keep explicit Print buttons. |
| Admin and Manager Currency selectors | Remove from Settings; do not add FX behavior. |
| Admin and Manager Round Off switches | Remove; no configurable rounding mode. |
| Browser-local hotel metadata fields | Replace with the authoritative `hotel` response/update flow for `HOTEL_ADMIN`; remove from Manager Settings. |
| “System preferences were updated successfully” after localStorage writes | Remove. Success must follow a committed authoritative backend mutation. |
| Admin static `GST 5%` Default Tax | Replace with real active same-hotel tax slabs and persisted default reference. |
| Manager mock `tax-001` Default Tax and mock tax list | Remove; never map mock identifiers into production settings. |
| Nonfunctional Service Charge controls | Replace only after the unresolved calculation and role decisions are approved and backend implementation exists. |
| Global `aazira-admin-settings` Settings persistence | Stop using for authoritative configuration. |
| Settings portion of `aazira-manager-workspace-v1` | Stop using for authoritative configuration; do not migrate it into PostgreSQL. |

## 10. Persistence Requirements

### 10.1 Typed hotel billing configuration

A typed one-to-one model is justified; a generic key/value table is not.

Proposed logical shape (not a migration):

| Field | Type | Validation/constraint | Purpose |
|---|---|---|---|
| `hotel_id` | UUID PK/FK | References `hotel.id`, one row per hotel | Scope and ownership. |
| `service_charge_enabled` | Boolean | Required | Explicit enablement. |
| `service_charge_rate` | Decimal(5,2) | `0.00 < rate <= 100.00` when enabled | Exact percentage configuration. |
| `default_tax_slab_id` | UUID, initially nullable | Composite same-hotel FK to `tax_slab` | Default preselection. |
| `created_at` | Timestamptz | Server generated | Persistence history. |
| `updated_at` | Timestamptz | Server generated/updated | Persistence history. |

The same-hotel FK requires a compatible unique key on `tax_slab(hotel_id, id)` or an equivalent database-enforced relationship. Service checks alone are not sufficient for cross-hotel integrity.

### 10.2 Bill snapshot fields

| Field | Type | Requirement |
|---|---|---|
| `bill.service_charge_amount` | Decimal(12,2) | Required with default/backfill `0.00`. |
| `bill.service_charge_snapshot` | Nullable JSON | Null for legacy/no-charge bills; populated from authoritative calculation when enabled. |

### 10.3 Migration requirements

A migration is required for the typed billing-settings model and bill snapshot fields. Before writing it, the company must provide:

- the service-charge applicability/base/tax/discount rules;
- role ownership for service charge and default tax;
- default-tax missing/inactive/deletion behavior;
- per-hotel service-charge and default-tax backfill values.

No migration is needed for hotel metadata because the fields already exist. Browser-local values must not be imported automatically because they are unauthenticated, unscoped, and may be mock data.

## 11. Billing/Financial Impact

The future implementation must preserve this safety contract:

1. The server remains the sole calculation authority.
2. All amounts use existing BigInt minor-unit and Decimal(12,2) persistence patterns.
3. Percentage arithmetic uses deterministic half-up rounding to two decimal places.
4. There is no nearest-rupee or configurable rounding step.
5. Calculation order cannot be finalized until section 3.2 is approved. The unresolved position of service charge relative to discount and tax is financially material.
6. New DRAFT bills resolve default tax and service charge under the hotel lock.
7. DRAFT recalculation/finalization revalidates current authoritative sources and settings.
8. Financially committed bill snapshots remain immutable.
9. Setting changes do not retroactively modify bills, payments, balances, or customer documents.
10. Customer APIs cannot submit tax, service charge, totals, or settings.
11. No payment gateway, payment execution, refund, or idempotency behavior changes.
12. No FX or multi-currency conversion is introduced.
13. Customer billing/PDF must show an applied service charge separately but must not expose tax registration.
14. Manager and Hotel Admin Reports retain their established calculations; persisted bill/payment values naturally include any approved service charge.

## 12. Audit Requirements

All authoritative Settings mutations must execute in the same database transaction as their audit event. Use the existing `audit_event` model, authenticated actor/assignment/scope, hotel ID, target ID/type, request ID, IP address, and user agent conventions.

| Mutation | Expected action | Target | Safe metadata |
|---|---|---|---|
| HOTEL_ADMIN hotel metadata update | Reuse `HOTEL_METADATA_UPDATED` | `HOTEL`, hotel ID | `changed_fields` only, preserving the existing allowlist behavior. |
| Service-charge configuration change | Add `HOTEL_SERVICE_CHARGE_SETTINGS_UPDATED` | Proposed `HOTEL_BILLING_SETTINGS`, hotel ID or settings ID | `changed_fields`; optional previous/current enabled and rate values only if explicitly allowlisted. Never include bills, secrets, or client-calculated totals. |
| Default-tax change | Add `HOTEL_DEFAULT_TAX_UPDATED` | Proposed `HOTEL_BILLING_SETTINGS`, hotel ID or settings ID | Previous/current tax-slab IDs or names, explicitly allowlisted; no tax amount is calculated by the audit layer. |

Additional requirements:

- An unchanged/idempotent request must not create a misleading change event.
- Rejected validation/authorization requests do not create success events.
- A failed audit insert must roll back the settings mutation.
- Bill snapshots, not settings audit rows, remain the authority for historical financial presentation.
- Existing tax-slab CRUD currently has no audit event; expanding that separate audit surface is outside this Settings contract unless required by the chosen default-tax dependency policy.

## 13. Open Company Decisions

Every item below blocks a complete financial implementation:

1. **REQUIRES COMPANY DECISION:** Does service charge apply to restaurant bills, room bills, or both?
2. **REQUIRES COMPANY DECISION:** Is its base the pre-discount subtotal, post-discount subtotal, or another persisted amount?
3. **REQUIRES COMPANY DECISION:** Is service charge taxable?
4. **REQUIRES COMPANY DECISION:** Do discounts reduce the service-charge base?
5. **REQUIRES COMPANY DECISION:** Which role may change service charge: `HOTEL_ADMIN`, `MANAGER`, or both?
6. **REQUIRES COMPANY DECISION:** Which role may change default tax: `HOTEL_ADMIN`, `MANAGER`, or both?
7. **REQUIRES COMPANY DECISION:** Does missing default tax block bill creation or merely create an untaxed DRAFT requiring staff selection?
8. **REQUIRES COMPANY DECISION:** Is deactivation/deletion of the configured default tax rejected, or does it clear the default and mark billing configuration incomplete?
9. **REQUIRES COMPANY DECISION:** What service-charge rate/enabled value and default tax slab should be backfilled for each existing hotel?

## 14. Implementation Plan for the NEXT Phase

The next phase must begin only after section 13 is approved.

1. Record the nine decisions as an approved addendum to this contract.
2. Add focused tests that encode calculation order, role ownership, cross-hotel rejection, draft refresh, immutable snapshots, audit rollback, and legacy-bill compatibility.
3. Add typed Prisma/database persistence for `hotel_billing_settings`, same-hotel default-tax integrity, `bill.service_charge_amount`, and `bill.service_charge_snapshot`; create a production-safe backfill from approved per-hotel values.
4. Add hotel-scoped Settings read/update APIs with middleware order: authentication → UUID validation → hotel scope → approved role authorization → controller → transactional service/audit.
5. Add a hotel-scoped `HOTEL_ADMIN` metadata endpoint reusing current validation and audit conventions; remove competing metadata mutation from Super Admin for delegated fields while preserving company lifecycle control.
6. Integrate default-tax preselection and service-charge calculation into bill creation, recalculation, and finalization under the existing hotel lock.
7. Extend staff/customer billing projections and PDF/receipt summaries with snapshotted service charge; keep tax registration excluded.
8. Replace both mock/localStorage Settings experiences with role-specific real data and remove prohibited controls.
9. Verify Manager Reports and Hotel Admin Reports retain their established definitions.
10. Run focused Settings/billing/audit suites, full financial regressions, frontend checks/build, Prisma validation/status/drift, live authorization, and residue checks.

## 15. Explicit Non-Goals

- Generic key/value Settings storage.
- Auto-print configuration or background printing.
- Currency selection in Settings, FX, currency conversion, or multi-currency billing.
- Nearest-rupee or user-configurable rounding.
- Customer-visible GST/tax registration number.
- Changes to payment gateways, payment execution, idempotency, refunds, or chargebacks.
- Retroactive recalculation of finalized, partially paid, paid, or void bills.
- Client-calculated service charge, tax, discount, total, or balance.
- New notification-preference functionality.
- Moving tax-slab or discount CRUD into Settings.
- Changing report definitions.
- Importing browser-local/mock Settings values into PostgreSQL.
- Changing company-level hotel lifecycle or identity management.
