BEGIN;

ALTER TABLE bill
  ADD COLUMN taxable_subtotal DECIMAL(12,2),
  ADD COLUMN tax_snapshot JSONB,
  ADD COLUMN discount_snapshot JSONB;

ALTER TABLE bill DISABLE TRIGGER bill_history_guard;
UPDATE bill SET taxable_subtotal = subtotal;
ALTER TABLE bill ENABLE TRIGGER bill_history_guard;
ALTER TABLE bill ALTER COLUMN taxable_subtotal SET NOT NULL;

ALTER TABLE bill_item
  ADD COLUMN menu_item_id UUID,
  ADD COLUMN menu_category_id UUID,
  ADD COLUMN discount_eligible BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE bill DROP CONSTRAINT bill_amount_check;
ALTER TABLE bill ADD CONSTRAINT bill_amount_check CHECK (
  subtotal >= 0
  AND discount_amount >= 0 AND discount_amount <= subtotal
  AND taxable_subtotal = subtotal - discount_amount
  AND tax_amount >= 0
  AND total_amount = taxable_subtotal + tax_amount
  AND amount_paid >= 0 AND amount_paid <= total_amount
  AND balance_due = total_amount - amount_paid
);

ALTER TABLE bill_item DROP CONSTRAINT bill_item_amount_check;
ALTER TABLE bill_item ADD CONSTRAINT bill_item_amount_check CHECK (
  quantity >= 0 AND unit_price >= 0 AND subtotal = quantity * unit_price
  AND discount_amount >= 0 AND discount_amount <= subtotal
  AND tax_amount >= 0
  AND total_amount = subtotal - discount_amount + tax_amount
);

COMMIT;
