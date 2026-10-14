BEGIN;

-- Refuse to harden ambiguous or cross-hotel legacy relationships silently.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM qr_code q
    LEFT JOIN room r ON r.id = q.room_id
    LEFT JOIN dining_table t ON t.id = q.dining_table_id
    WHERE NOT (
      (q.type = 'room' AND q.room_id IS NOT NULL AND q.dining_table_id IS NULL AND r.hotel_id = q.hotel_id)
      OR
      (q.type = 'dining_table' AND q.dining_table_id IS NOT NULL AND q.room_id IS NULL AND t.hotel_id = q.hotel_id)
    )
  ) OR EXISTS (
    SELECT 1 FROM dining_table t JOIN dining_area a ON a.id = t.dining_area_id
    WHERE t.hotel_id <> a.hotel_id
  ) OR EXISTS (
    SELECT 1 FROM room_booking b JOIN room r ON r.id = b.room_id
    WHERE b.hotel_id <> r.hotel_id
  ) OR EXISTS (
    SELECT 1 FROM orders o JOIN room_booking b ON b.id = o.room_booking_id
    WHERE o.hotel_id <> b.hotel_id
  ) OR EXISTS (
    SELECT 1 FROM orders o JOIN dining_table t ON t.id = o.table_id
    WHERE o.hotel_id <> t.hotel_id
  ) THEN
    RAISE EXCEPTION 'QR_INFRASTRUCTURE_REQUIRES_RECONCILIATION';
  END IF;
END $$;

ALTER TABLE dining_table DROP CONSTRAINT dining_table_dining_area_id_fkey;
ALTER TABLE room_booking DROP CONSTRAINT room_booking_room_id_fkey;
ALTER TABLE orders DROP CONSTRAINT orders_room_booking_id_fkey;
ALTER TABLE orders DROP CONSTRAINT orders_table_id_fkey;
ALTER TABLE qr_code DROP CONSTRAINT qr_code_room_id_fkey;
ALTER TABLE qr_code DROP CONSTRAINT qr_code_dining_table_id_fkey;

ALTER TABLE room_booking
  ADD COLUMN ordering_capability_hash VARCHAR(64),
  ADD COLUMN ordering_capability_created_at TIMESTAMPTZ(6);

CREATE UNIQUE INDEX uq_dining_area_hotel_scope ON dining_area(id, hotel_id);
CREATE UNIQUE INDEX uq_dining_table_hotel_scope ON dining_table(id, hotel_id);
CREATE UNIQUE INDEX uq_room_hotel_scope ON room(id, hotel_id);
CREATE UNIQUE INDEX uq_room_booking_hotel_scope ON room_booking(id, hotel_id);
CREATE UNIQUE INDEX uq_room_booking_ordering_capability_hash ON room_booking(ordering_capability_hash);
CREATE UNIQUE INDEX uq_qr_code_room_hotel_scope ON qr_code(room_id, hotel_id);
CREATE UNIQUE INDEX uq_qr_code_dining_table_hotel_scope ON qr_code(dining_table_id, hotel_id);

ALTER TABLE dining_table ADD CONSTRAINT dining_table_dining_area_id_hotel_id_fkey
  FOREIGN KEY (dining_area_id, hotel_id) REFERENCES dining_area(id, hotel_id)
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE room_booking ADD CONSTRAINT room_booking_room_id_hotel_id_fkey
  FOREIGN KEY (room_id, hotel_id) REFERENCES room(id, hotel_id)
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE orders ADD CONSTRAINT orders_room_booking_id_hotel_id_fkey
  FOREIGN KEY (room_booking_id, hotel_id) REFERENCES room_booking(id, hotel_id)
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE orders ADD CONSTRAINT orders_table_id_hotel_id_fkey
  FOREIGN KEY (table_id, hotel_id) REFERENCES dining_table(id, hotel_id)
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE qr_code ADD CONSTRAINT qr_code_room_id_hotel_id_fkey
  FOREIGN KEY (room_id, hotel_id) REFERENCES room(id, hotel_id)
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE qr_code ADD CONSTRAINT qr_code_dining_table_id_hotel_id_fkey
  FOREIGN KEY (dining_table_id, hotel_id) REFERENCES dining_table(id, hotel_id)
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE qr_code ADD CONSTRAINT qr_code_target_matches_type
  CHECK (
    (type = 'room' AND room_id IS NOT NULL AND dining_table_id IS NULL)
    OR
    (type = 'dining_table' AND dining_table_id IS NOT NULL AND room_id IS NULL)
  );

COMMIT;
