DROP TRIGGER "trg_order_item_active_hotel" ON "order_item";
DROP TRIGGER "trg_bill_item_active_hotel" ON "bill_item";
DROP TRIGGER "trg_discount_menu_category_active_hotel" ON "discount_menu_category";
DROP TRIGGER "trg_discount_menu_item_active_hotel" ON "discount_menu_item";

-- Parent deletes are already serialized and gated by the parent's direct hotel
-- trigger. Child cascade deletes must not re-resolve a parent being deleted.
CREATE TRIGGER "trg_order_item_active_hotel" BEFORE INSERT OR UPDATE ON "order_item"
FOR EACH ROW EXECUTE FUNCTION "assert_active_order_item_mutation"();

CREATE TRIGGER "trg_bill_item_active_hotel" BEFORE INSERT OR UPDATE ON "bill_item"
FOR EACH ROW EXECUTE FUNCTION "assert_active_bill_item_mutation"();

CREATE TRIGGER "trg_discount_menu_category_active_hotel" BEFORE INSERT OR UPDATE ON "discount_menu_category"
FOR EACH ROW EXECUTE FUNCTION "assert_active_discount_mapping_mutation"();

CREATE TRIGGER "trg_discount_menu_item_active_hotel" BEFORE INSERT OR UPDATE ON "discount_menu_item"
FOR EACH ROW EXECUTE FUNCTION "assert_active_discount_mapping_mutation"();
