BEGIN;

ALTER TABLE bill ADD CONSTRAINT billing_adjustment_snapshot_check CHECK (
  (tax_snapshot IS NULL AND tax_amount = 0)
  OR (jsonb_typeof(tax_snapshot) = 'object'
      AND (tax_snapshot->>'amount')::numeric = tax_amount
      AND (tax_snapshot->>'taxable_subtotal')::numeric = taxable_subtotal)
);

ALTER TABLE bill ADD CONSTRAINT billing_discount_snapshot_check CHECK (
  (discount_snapshot IS NULL AND discount_amount = 0)
  OR (jsonb_typeof(discount_snapshot) = 'object'
      AND (discount_snapshot->>'amount')::numeric = discount_amount
      AND (discount_snapshot->>'eligible_subtotal')::numeric >= discount_amount)
);

-- Preserve the already-supported Captain and dining-table QR source contract on clean deployments.
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
