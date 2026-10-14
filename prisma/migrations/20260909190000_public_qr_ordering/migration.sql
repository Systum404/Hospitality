BEGIN;

-- Public-order idempotency is optional for existing staff orders, but its two
-- fields must always be populated together when used.
ALTER TABLE orders
  ADD COLUMN idempotency_key UUID,
  ADD COLUMN idempotency_fingerprint CHAR(64);

CREATE UNIQUE INDEX uq_orders_public_idempotency
  ON orders(hotel_id, idempotency_key);

ALTER TABLE orders ADD CONSTRAINT orders_idempotency_pair_check CHECK (
  (idempotency_key IS NULL AND idempotency_fingerprint IS NULL)
  OR
  (idempotency_key IS NOT NULL AND idempotency_fingerprint IS NOT NULL)
);

-- Enforce only the approved QR source/target invariants. Existing Captain and
-- Admin semantics are deliberately left unchanged.
ALTER TABLE orders ADD CONSTRAINT orders_qr_source_target_check CHECK (
  (source <> 'room_qr' OR (room_booking_id IS NOT NULL AND table_id IS NULL))
  AND
  (source <> 'dining_table_qr' OR (table_id IS NOT NULL AND room_booking_id IS NULL))
);

ALTER TABLE order_item ADD COLUMN item_name VARCHAR(255);

-- A finalized bill line is the only immutable historical name evidence in the
-- current database. Refuse to guess for legacy rows lacking one unambiguous line.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM order_item oi
    LEFT JOIN (
      SELECT source_item_id, min(description) AS description, count(DISTINCT description) AS descriptions
      FROM bill_item
      WHERE source_item_id IS NOT NULL
      GROUP BY source_item_id
    ) bi ON bi.source_item_id = oi.id
    WHERE bi.source_item_id IS NULL OR bi.descriptions <> 1
  ) THEN
    RAISE EXCEPTION 'ORDER_ITEM_NAME_RECONCILIATION_REQUIRED';
  END IF;
END $$;

ALTER TABLE order_item DISABLE TRIGGER order_item_billing_guard;

UPDATE order_item oi
SET item_name = bi.description
FROM (
  SELECT source_item_id, min(description) AS description
  FROM bill_item
  WHERE source_item_id IS NOT NULL
  GROUP BY source_item_id
) bi
WHERE bi.source_item_id = oi.id;

ALTER TABLE order_item ENABLE TRIGGER order_item_billing_guard;

ALTER TABLE order_item ALTER COLUMN item_name SET NOT NULL;

-- Preserve the existing billing guard verbatim except that the established
-- restaurant bill type may now reference Captain or dining-table QR orders.
CREATE OR REPLACE FUNCTION billing_bill_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'BILL_HISTORY_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 PERFORM id FROM hotel WHERE id=NEW.hotel_id FOR UPDATE;
 IF NEW.room_booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM room_booking WHERE id=NEW.room_booking_id AND hotel_id=NEW.hotel_id) THEN
   RAISE EXCEPTION 'BILL_SOURCE_SCOPE_MISMATCH' USING ERRCODE='P0001';
 END IF;
 IF NEW.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id AND hotel_id=NEW.hotel_id AND source IN ('captain','dining_table_qr') AND room_booking_id IS NULL) THEN
   RAISE EXCEPTION 'BILL_SOURCE_SCOPE_MISMATCH' USING ERRCODE='P0001';
 END IF;
 IF TG_OP = 'UPDATE' THEN
   IF NEW.id <> OLD.id OR NEW.hotel_id <> OLD.hotel_id OR NEW.invoice_number <> OLD.invoice_number OR
      NEW.room_booking_id IS DISTINCT FROM OLD.room_booking_id OR NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      RAISE EXCEPTION 'BILL_IDENTITY_IMMUTABLE' USING ERRCODE='P0001';
   END IF;
   IF OLD.status <> 'DRAFT' AND
      (to_jsonb(NEW) - ARRAY['amount_paid','balance_due','status','voided_at','voided_by']) IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['amount_paid','balance_due','status','voided_at','voided_by']) THEN
      RAISE EXCEPTION 'BILL_SNAPSHOT_IMMUTABLE' USING ERRCODE='P0001';
   END IF;
   IF NOT (NEW.status=OLD.status OR
      (OLD.status='DRAFT' AND NEW.status IN ('FINALIZED','PAID','VOID')) OR
      (OLD.status='FINALIZED' AND NEW.status IN ('PARTIALLY_PAID','PAID','VOID')) OR
      (OLD.status='PARTIALLY_PAID' AND NEW.status='PAID')) THEN
      RAISE EXCEPTION 'INVALID_BILL_TRANSITION' USING ERRCODE='P0001';
   END IF;
 END IF;
 IF NEW.amount_paid <> COALESCE((SELECT sum(amount) FROM payment WHERE bill_id=NEW.id),0) THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_MISMATCH' USING ERRCODE='P0001';
 END IF;
 IF NEW.status='VOID' AND EXISTS(SELECT 1 FROM payment WHERE bill_id=NEW.id) THEN
    RAISE EXCEPTION 'BILL_HAS_PAYMENTS' USING ERRCODE='P0001';
 END IF;
 IF (TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.status='DRAFT' AND NEW.status IN ('FINALIZED','PAID'))) AND
    NEW.room_booking_id IS NOT NULL AND EXISTS (SELECT 1 FROM room_booking WHERE id=NEW.room_booking_id AND paid_amount <> 0) THEN
    RAISE EXCEPTION 'LEGACY_PAYMENT_RECONCILIATION_REQUIRED' USING ERRCODE='P0001';
 END IF;
 IF TG_OP='INSERT' AND NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'INVALID_BILL_TRANSITION' USING ERRCODE='P0001'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='DRAFT' AND NEW.status IN ('FINALIZED','PAID') THEN
   IF NEW.total_amount <> COALESCE((SELECT sum(total_amount) FROM bill_item WHERE bill_id=NEW.id),0) THEN
     RAISE EXCEPTION 'PAYMENT_LEDGER_MISMATCH' USING ERRCODE='P0001';
   END IF;
   IF NEW.room_booking_id IS NOT NULL AND EXISTS (SELECT 1 FROM orders WHERE room_booking_id=NEW.room_booking_id AND
      (status <> 'completed' OR source <> 'room_qr' OR hotel_id <> NEW.hotel_id)) THEN
     RAISE EXCEPTION 'ROOM_ORDERS_UNFINISHED' USING ERRCODE='P0001';
   END IF;
 END IF;
 IF (NEW.status='PAID' AND NEW.balance_due <> 0) OR
    (NEW.status='PARTIALLY_PAID' AND (NEW.amount_paid <= 0 OR NEW.balance_due <= 0)) OR
    (NEW.status='FINALIZED' AND (NEW.amount_paid <> 0 OR NEW.balance_due <= 0)) OR
    (NEW.status='DRAFT' AND NEW.amount_paid <> 0) THEN
   RAISE EXCEPTION 'INVALID_BILL_TRANSITION' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;

COMMIT;
