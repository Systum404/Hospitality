# AAZIRA persisted notification contract

This document describes the notification behavior implemented by the current AAZIRA backend. It is a statement of the existing contract, not a roadmap.

## Architecture

Notifications follow the authoritative business write:

`business mutation -> authoritative database transaction -> recipient selection -> persisted notification -> shared notification API -> shared staff Header`

Producers call the shared helpers in `services/operationalNotificationService.js` from inside the transaction that owns the business mutation. The helpers select recipients, then persist one row per recipient. The role-neutral `/api/hotels/:hotelId/notifications` API lists or marks notifications for the authenticated user and hotel. The shared Header consumes that API; it does not use mock data or browser storage as notification truth.

## Approved events

| Event | Exact trigger | Recipient and scope | `event_key` | Transaction requirement | Important exclusions |
| --- | --- | --- | --- | --- | --- |
| Room booking created | A booking is successfully created initially in `reserved` or `confirmed` state | Every active Reception user assigned to the same hotel | `booking-created:<booking id>` | Same transaction as booking creation | No notification for failed creation or other initial states; an initially confirmed booking does not also emit Booking Confirmed |
| Booking confirmed | Existing booking transitions `reserved -> confirmed` | Every active Reception user assigned to the same hotel | `booking-confirmed:<booking id>` | Same transaction as the status transition | No notification for repeated confirmation, edits, or cancellation |
| Guest checked in | Existing booking transitions `confirmed -> checked-in` | Every active Reception user assigned to the same hotel | `booking-checked-in:<booking id>` | Same transaction as the status transition | No notification for an idempotent repeated status request |
| Guest checked out | Existing booking transitions `checked-in -> checked-out` | Every active Reception user assigned to the same hotel | `booking-checked-out:<booking id>` | Same transaction as the status transition | No notification for an idempotent repeated status request |
| Room-service order created | A `room_qr` room-service order is successfully created through the authenticated room-order or public Room QR workflow | Every active Reception user assigned to the same hotel | `room-order-created:<order id>` | Same transaction as order creation | Status updates emit none; this event is not the Kitchen restaurant-order event |
| Room payment recorded | A payment row is successfully recorded for a ROOM bill | Every active Reception user assigned to the same hotel | `payment-recorded:<payment id>` | Same transaction as payment creation and balance update | Restaurant-bill payments emit none; idempotent payment retries do not duplicate the event |
| Captain restaurant order created | A `captain` restaurant order is successfully created | Every active Kitchen user assigned to the same hotel | `restaurant-order-created:<order id>` | Same transaction as order creation | Room QR orders do not emit this event; failed creation does not add a notification |
| Table QR order created | A `dining_table_qr` order is successfully created | Every active Captain user assigned to the same hotel | `captain-table-order-created:<order id>` | Same transaction as order creation | The customer capability and PII are not included |
| Table QR handed to Kitchen | A Captain claims and hands a `dining_table_qr` order to Kitchen | Every active Kitchen user assigned to the same hotel | `restaurant-order-created:<order id>` | Same transaction as assignment | Repeated handoff by the assigned Captain is idempotent and does not duplicate notifications |
| Restaurant order ready | A restaurant order with an assigned Captain transitions to `ready` | The active assigned Captain, if that user still has the Captain role in the same hotel | `restaurant-order-ready:<order id>` | Same transaction as the order and item status transition | Unassigned orders, repeated READY, backward transitions, and non-Captain assignees emit none |
| Low-stock threshold crossing | Inventory changes from `quantity > minimum_quantity` to `quantity <= minimum_quantity` | Every active Manager user assigned to the same hotel | `inventory-low:<inventory id>:<episode UUID>` | Same transaction as the inventory update, after locking the inventory row | Creation, already-low updates, and recovery emit none |
| New order created | A room-service or restaurant order is successfully created | Every active Manager user assigned to the same hotel | `manager-order-created:<order id>` | Same transaction as order creation | Status updates, failed creation, and an idempotent duplicate request emit none |
| Bill finalized | A non-zero DRAFT bill successfully transitions to FINALIZED | Every active Manager user assigned to the same hotel | `manager-bill-finalized:<bill id>` | Same transaction as snapshot refresh and finalization | No event for draft creation, recalculation, tax/discount edits, payment, partial payment, paid transition, void, repeated finalization, or a zero-total DRAFT that transitions directly to PAID |

## Order source semantics

- Room QR (`room_qr`) creates room service.
- Captain (`captain`) creates restaurant service.
- Dining Table QR (`dining_table_qr`) creates restaurant service for Captain intake, then Kitchen receives it after Captain handoff.
- A Room QR order does **not** generate the restaurant-order notification for Kitchen.

All successful sources generate the approved Manager New Order event. Room QR also generates the approved Reception and Kitchen room-service events. Captain-created restaurant orders notify Kitchen immediately; Table QR restaurant orders notify Captain first and Kitchen only after Captain handoff.

## Low-stock episodes

Low-stock behavior is transition-based:

- above minimum -> at or below minimum: one notification episode;
- already low -> still low: no notification;
- low -> recovered: no notification;
- recovered -> low: a new notification episode.

Transition detection is serialized with a PostgreSQL row lock on the inventory record. Each new episode receives a distinct event key; recipient-level uniqueness still applies within that episode.

## Billing semantics

Only the `DRAFT -> FINALIZED` transition produces the Manager Bill Finalized notification. Draft creation, recalculation, tax or discount selection changes, payment recording, partial-payment and paid transitions, voiding, and repeated finalization do not produce that Manager event. A zero-total bill transitions directly from DRAFT to PAID and therefore does not emit Bill Finalized.

## Recipient security and reads

Role-targeted recipients must be active users with the required role assignment in the same hotel. Assigned-user delivery additionally verifies the user, role, and hotel assignment. Multi-role users are deduplicated by user ID and receive at most one row for an event/role selection.

Notification reads and read mutations are scoped to both the authenticated user and authenticated hotel. A caller cannot list or mark another user's or another hotel's rows through the shared API.

The data/producer layer supports selecting a user who has multiple role assignments. The authentication API now supports explicit multi-assignment context selection; notification delivery still uses the authoritative selected assignment context.

## Deduplication

The database identity for a notification delivery is:

`hotel_id + user_id + event_key`

It is enforced by `uq_notification_hotel_user_event`. Producers use `createMany({ skipDuplicates: true })`, while the database unique constraint remains authoritative for concurrent attempts. Current key forms are:

- `booking-created:<booking id>`
- `booking-confirmed:<booking id>`
- `booking-checked-in:<booking id>`
- `booking-checked-out:<booking id>`
- `room-order-created:<order id>`
- `payment-recorded:<payment id>`
- `restaurant-order-created:<order id>`
- `restaurant-order-ready:<order id>`
- `inventory-low:<inventory id>:<episode UUID>`
- `manager-order-created:<order id>`
- `manager-bill-finalized:<bill id>`

## Transaction guarantees

Notification insertion occurs inside the authoritative business transaction. A failed or rolled-back booking, order, inventory, billing, payment, or status mutation therefore leaves no notification. Concurrent retries are protected by the relevant business lock and/or the recipient event-key unique constraint.

## Lifecycle and retention

Current foreign-key behavior is the retention contract in effect:

- deleting a user cascades that user's notifications;
- deleting a hotel cascades that hotel's notifications;
- deactivating a user leaves existing notifications intact;
- removing a role assignment leaves existing notifications intact;
- deleting a normal source order or booking does not delete its historical notification because `event_key` is textual and has no source-row foreign key.

A formal long-term notification retention policy is not defined.

## Explicit non-goals

The current system does not implement:

- notification preferences;
- retention beyond the database behavior above;
- polling;
- WebSockets;
- Server-Sent Events (SSE);
- action URLs for operational notifications;
- Admin notification producers;
- multi-role login context selection.
