BEGIN;
CREATE SEQUENCE bill_invoice_sequence AS bigint MINVALUE 1 MAXVALUE 999999999999 NO CYCLE;
-- CreateTable
CREATE TABLE "bill" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "invoice_number" VARCHAR(50) NOT NULL DEFAULT ('INV-'::text || to_char(nextval('bill_invoice_sequence'::regclass), 'FM000000000000'::text)),
    "type" VARCHAR(20) NOT NULL,
    "room_booking_id" UUID,
    "order_id" UUID,
    "source_reference" VARCHAR(50) NOT NULL,
    "hotel_snapshot" JSONB NOT NULL,
    "guest_snapshot" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "balance_due" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "finalized_by" UUID,
    "voided_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMPTZ(6),
    "voided_at" TIMESTAMPTZ(6),

    CONSTRAINT "bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_item" (
    "id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "source_order_id" UUID,
    "source_item_id" UUID,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "bill_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RECORDED',
    "reference" VARCHAR(255),
    "notes" TEXT,
    "idempotency_key" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bill_invoice_number_key" ON "bill"("invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "bill_room_booking_id_key" ON "bill"("room_booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_order_id_key" ON "bill"("order_id");

-- CreateIndex
CREATE INDEX "bill_hotel_id_created_at_idx" ON "bill"("hotel_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bill_id_hotel_id_key" ON "bill"("id", "hotel_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_item_bill_id_position_key" ON "bill_item"("bill_id", "position");

-- CreateIndex
CREATE INDEX "payment_bill_id_created_at_idx" ON "payment"("bill_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_hotel_id_idempotency_key_key" ON "payment"("hotel_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "bill" ADD CONSTRAINT "bill_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill" ADD CONSTRAINT "bill_room_booking_id_fkey" FOREIGN KEY ("room_booking_id") REFERENCES "room_booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill" ADD CONSTRAINT "bill_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_item" ADD CONSTRAINT "bill_item_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_bill_id_hotel_id_fkey" FOREIGN KEY ("bill_id", "hotel_id") REFERENCES "bill"("id", "hotel_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Application financial contract. These CHECKs and guards are new, explicit billing rules.
ALTER TABLE bill ADD CONSTRAINT bill_source_check CHECK (
 (type = 'ROOM' AND room_booking_id IS NOT NULL AND order_id IS NULL) OR
 (type = 'CAPTAIN' AND order_id IS NOT NULL AND room_booking_id IS NULL));
ALTER TABLE bill ADD CONSTRAINT bill_amount_check CHECK (
 subtotal >= 0 AND tax_amount = 0 AND discount_amount = 0 AND total_amount = subtotal
 AND amount_paid >= 0 AND amount_paid <= total_amount AND balance_due = total_amount - amount_paid);
ALTER TABLE bill ADD CONSTRAINT bill_status_check CHECK (status IN ('DRAFT','FINALIZED','PARTIALLY_PAID','PAID','VOID'));
ALTER TABLE bill_item ADD CONSTRAINT bill_item_amount_check CHECK (
 quantity >= 0 AND unit_price >= 0 AND subtotal = quantity * unit_price
 AND tax_amount = 0 AND discount_amount = 0 AND total_amount = subtotal);
ALTER TABLE payment ADD CONSTRAINT payment_amount_check CHECK (amount > 0);
ALTER TABLE payment ADD CONSTRAINT payment_method_check CHECK (method IN ('Cash','UPI','Card'));
ALTER TABLE payment ADD CONSTRAINT payment_status_check CHECK (status = 'RECORDED');

CREATE FUNCTION billing_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tenant uuid; booking uuid; locked boolean;
BEGIN
 tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD.hotel_id ELSE NEW.hotel_id END;
 -- Same lock as billing finalization; serialize source changes and finalization.
 PERFORM id FROM hotel WHERE id = tenant FOR UPDATE;
 IF TG_TABLE_NAME = 'room_booking' THEN
   IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM bill WHERE room_booking_id = OLD.id AND status <> 'DRAFT') THEN
     IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'BILLED_SOURCE_LOCKED' USING ERRCODE = 'P0001'; END IF;
     IF (to_jsonb(NEW) - ARRAY['status','checked_in_at','checked_out_at','updated_at']) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['status','checked_in_at','checked_out_at','updated_at']) THEN
       RAISE EXCEPTION 'BILLED_SOURCE_LOCKED' USING ERRCODE = 'P0001';
     END IF;
   END IF;
 ELSE
   booking := CASE WHEN TG_OP = 'DELETE' THEN OLD.room_booking_id ELSE NEW.room_booking_id END;
   IF booking IS NOT NULL AND EXISTS (SELECT 1 FROM bill WHERE room_booking_id = booking AND status <> 'DRAFT') THEN
     RAISE EXCEPTION 'BILLED_SOURCE_LOCKED' USING ERRCODE = 'P0001';
   END IF;
   IF TG_OP <> 'INSERT' AND (EXISTS (SELECT 1 FROM bill WHERE order_id = OLD.id AND status <> 'DRAFT')
      OR EXISTS (SELECT 1 FROM bill WHERE room_booking_id = OLD.room_booking_id AND status <> 'DRAFT')) THEN
     -- Captain kitchen progress may continue; financial fields may not change.
     IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'BILLED_SOURCE_LOCKED' USING ERRCODE = 'P0001'; END IF;
     IF (to_jsonb(NEW) - ARRAY['status','completed_at','updated_at']) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['status','completed_at','updated_at']) THEN
       RAISE EXCEPTION 'BILLED_SOURCE_LOCKED' USING ERRCODE = 'P0001';
     END IF;
   END IF;
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER booking_billing_guard BEFORE INSERT OR UPDATE OR DELETE ON room_booking FOR EACH ROW EXECUTE FUNCTION billing_source_guard();
CREATE TRIGGER order_billing_guard BEFORE INSERT OR UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION billing_source_guard();

CREATE FUNCTION billing_order_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source orders; oid uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.order_id <> OLD.order_id AND EXISTS (
   SELECT 1 FROM orders o JOIN bill b ON b.order_id=o.id OR b.room_booking_id=o.room_booking_id
   WHERE o.id=OLD.order_id AND b.status <> 'DRAFT') THEN
   RAISE EXCEPTION 'BILLED_SOURCE_LOCKED' USING ERRCODE='P0001';
 END IF;
 oid := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
 SELECT * INTO source FROM orders WHERE id=oid;
 PERFORM id FROM hotel WHERE id=source.hotel_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM bill WHERE status <> 'DRAFT' AND (order_id=oid OR room_booking_id=source.room_booking_id)) THEN
   IF TG_OP = 'UPDATE' THEN
     IF (to_jsonb(NEW) - ARRAY['status','updated_at']) = (to_jsonb(OLD) - ARRAY['status','updated_at']) THEN RETURN NEW; END IF;
   END IF;
   RAISE EXCEPTION 'BILLED_SOURCE_LOCKED' USING ERRCODE='P0001';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER order_item_billing_guard BEFORE INSERT OR UPDATE OR DELETE ON order_item FOR EACH ROW EXECUTE FUNCTION billing_order_item_guard();

CREATE FUNCTION billing_bill_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'BILL_HISTORY_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 PERFORM id FROM hotel WHERE id=NEW.hotel_id FOR UPDATE;
 IF NEW.room_booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM room_booking WHERE id=NEW.room_booking_id AND hotel_id=NEW.hotel_id) THEN
   RAISE EXCEPTION 'BILL_SOURCE_SCOPE_MISMATCH' USING ERRCODE='P0001';
 END IF;
 IF NEW.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id AND hotel_id=NEW.hotel_id AND source='captain' AND room_booking_id IS NULL) THEN
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
CREATE TRIGGER bill_history_guard BEFORE INSERT OR UPDATE OR DELETE ON bill FOR EACH ROW EXECUTE FUNCTION billing_bill_guard();

CREATE FUNCTION billing_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bid uuid; current_status text;
BEGIN
 bid := CASE WHEN TG_OP='DELETE' THEN OLD.bill_id ELSE NEW.bill_id END;
 SELECT status INTO current_status FROM bill WHERE id=bid FOR UPDATE;
 IF current_status <> 'DRAFT' THEN RAISE EXCEPTION 'BILL_SNAPSHOT_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF TG_OP='UPDATE' AND NEW.bill_id <> OLD.bill_id THEN RAISE EXCEPTION 'BILL_SNAPSHOT_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER bill_item_history_guard BEFORE INSERT OR UPDATE OR DELETE ON bill_item FOR EACH ROW EXECUTE FUNCTION billing_line_guard();

CREATE FUNCTION billing_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target bill;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'PAYMENT_HISTORY_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 PERFORM id FROM hotel WHERE id=NEW.hotel_id FOR UPDATE;
 SELECT * INTO target FROM bill WHERE id=NEW.bill_id AND hotel_id=NEW.hotel_id FOR UPDATE;
 IF NOT FOUND OR target.status NOT IN ('FINALIZED','PARTIALLY_PAID') THEN RAISE EXCEPTION 'BILL_NOT_PAYABLE' USING ERRCODE='P0001'; END IF;
 IF NEW.amount <= 0 OR NEW.amount > target.balance_due THEN RAISE EXCEPTION 'INVALID_PAYMENT_AMOUNT' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payment_history_guard BEFORE INSERT OR UPDATE OR DELETE ON payment FOR EACH ROW EXECUTE FUNCTION billing_payment_guard();

CREATE FUNCTION billing_payment_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paid numeric;
BEGIN
 SELECT sum(amount) INTO paid FROM payment WHERE bill_id=NEW.bill_id;
 UPDATE bill SET amount_paid=paid, balance_due=total_amount-paid,
 status=CASE WHEN paid=total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END WHERE id=NEW.bill_id;
 RETURN NEW;
END $$;
CREATE TRIGGER payment_balance_update AFTER INSERT ON payment FOR EACH ROW EXECUTE FUNCTION billing_payment_balance();

COMMIT;
