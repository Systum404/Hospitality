BEGIN;

ALTER TABLE bill DROP CONSTRAINT billing_adjustment_snapshot_check;
ALTER TABLE bill ADD CONSTRAINT billing_adjustment_snapshot_check CHECK (
  ((tax_snapshot IS NULL OR jsonb_typeof(tax_snapshot) = 'null') AND tax_amount = 0)
  OR (jsonb_typeof(tax_snapshot) = 'object'
      AND (tax_snapshot->>'amount')::numeric = tax_amount
      AND (tax_snapshot->>'taxable_subtotal')::numeric = taxable_subtotal)
);

ALTER TABLE bill DROP CONSTRAINT billing_discount_snapshot_check;
ALTER TABLE bill ADD CONSTRAINT billing_discount_snapshot_check CHECK (
  ((discount_snapshot IS NULL OR jsonb_typeof(discount_snapshot) = 'null') AND discount_amount = 0)
  OR (jsonb_typeof(discount_snapshot) = 'object'
      AND (discount_snapshot->>'amount')::numeric = discount_amount
      AND (discount_snapshot->>'eligible_subtotal')::numeric >= discount_amount)
);

COMMIT;
