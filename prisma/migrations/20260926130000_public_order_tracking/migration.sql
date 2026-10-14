ALTER TABLE "orders"
    ADD COLUMN "tracking_capability_hash" CHAR(64),
    ADD COLUMN "tracking_capability_created_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "uq_orders_tracking_capability_hash"
    ON "orders"("tracking_capability_hash");

ALTER TABLE "orders"
    ADD CONSTRAINT "orders_tracking_capability_pair_check"
    CHECK (
        ("tracking_capability_hash" IS NULL AND "tracking_capability_created_at" IS NULL)
        OR
        (
            "tracking_capability_hash" IS NOT NULL
            AND "tracking_capability_created_at" IS NOT NULL
            AND "source" IN ('room_qr'::order_source, 'dining_table_qr'::order_source)
        )
    );
