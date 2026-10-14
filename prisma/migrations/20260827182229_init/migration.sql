-- CreateEnum
CREATE TYPE "discount_applicable_on" AS ENUM ('all', 'specific_items', 'categories');

-- CreateEnum
CREATE TYPE "discount_type" AS ENUM ('percentage', 'fixed_amount');

-- CreateEnum
CREATE TYPE "order_source" AS ENUM ('room_qr', 'dining_table_qr', 'captain', 'admin');

-- CreateEnum
CREATE TYPE "qr_code_type" AS ENUM ('room', 'dining_table');

-- CreateTable
CREATE TABLE "customer" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100),
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(255),
    "date_of_birth" DATE,
    "address" TEXT,
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "country" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "id_type" VARCHAR(50),
    "id_number" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dining_area" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "total_tables" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(30) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dining_area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dining_table" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "dining_area_id" UUID NOT NULL,
    "table_number" VARCHAR(50) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "status" VARCHAR(30) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dining_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "discount_type" "discount_type" NOT NULL,
    "discount_value" DECIMAL(10,2) NOT NULL,
    "min_order_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "max_discount_amount" DECIMAL(12,2),
    "applicable_on" VARCHAR(50) NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_menu_category" (
    "discount_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "discount_menu_category_pkey" PRIMARY KEY ("discount_id","category_id")
);

-- CreateTable
CREATE TABLE "discount_menu_item" (
    "discount_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,

    CONSTRAINT "discount_menu_item_pkey" PRIMARY KEY ("discount_id","menu_item_id")
);

-- CreateTable
CREATE TABLE "hotel" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "address" TEXT,
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "total_rooms" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(30) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "category" VARCHAR(100),
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unit" VARCHAR(50),
    "minimum_quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "supplier_id" UUID,
    "last_restocked" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_category" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "category_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "image_url" VARCHAR(500),
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "is_veg" BOOLEAN NOT NULL DEFAULT false,
    "preparation_time" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "action_url" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "special_instructions" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "customer_id" UUID,
    "table_id" UUID,
    "room_booking_id" UUID,
    "order_number" VARCHAR(50) NOT NULL,
    "source" "order_source" NOT NULL DEFAULT 'captain',
    "captain_id" UUID,
    "customer_name" VARCHAR(255) NOT NULL,
    "customer_phone" VARCHAR(20) NOT NULL,
    "customer_email" VARCHAR(255),
    "status" VARCHAR(30) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payment_method" VARCHAR(30),
    "payment_status" VARCHAR(30) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_code" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "type" "qr_code_type" NOT NULL,
    "room_id" UUID,
    "dining_table_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "room_number" VARCHAR(50) NOT NULL,
    "floor_number" SMALLINT NOT NULL DEFAULT 0,
    "capacity" INTEGER NOT NULL DEFAULT 2,
    "room_type" VARCHAR(100),
    "status" VARCHAR(30) NOT NULL,
    "base_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_booking" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "customer_id" UUID,
    "booking_number" VARCHAR(50) NOT NULL,
    "customer_name" VARCHAR(255) NOT NULL,
    "customer_phone" VARCHAR(20) NOT NULL,
    "customer_email" VARCHAR(255),
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "booking_from" TIMESTAMPTZ(6) NOT NULL,
    "booking_to" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "room_rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payment_status" VARCHAR(30) NOT NULL,
    "special_requests" TEXT,
    "notes" TEXT,
    "checked_in_at" TIMESTAMPTZ(6),
    "checked_out_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_slab" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "applicable_on" VARCHAR(30) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_slab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" INTEGER NOT NULL,
    "hotel_id" UUID,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "contact_person" VARCHAR(255),
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "address" TEXT,
    "category" VARCHAR(100),
    "rating" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_customer_email" ON "customer"("hotel_id", "email");

-- CreateIndex
CREATE INDEX "idx_customer_hotel_id" ON "customer"("hotel_id");

-- CreateIndex
CREATE INDEX "idx_customer_phone" ON "customer"("hotel_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "uq_customer_hotel_phone" ON "customer"("hotel_id", "phone");

-- CreateIndex
CREATE INDEX "idx_dining_area_hotel_id" ON "dining_area"("hotel_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_dining_area_name" ON "dining_area"("hotel_id", "name");

-- CreateIndex
CREATE INDEX "idx_dining_table_hotel_id" ON "dining_table"("hotel_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_dining_table_number" ON "dining_table"("hotel_id", "table_number");

-- CreateIndex
CREATE INDEX "idx_discount_active" ON "discount"("hotel_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_discount_dates" ON "discount"("start_date", "end_date");

-- CreateIndex
CREATE INDEX "idx_discount_hotel_id" ON "discount"("hotel_id");

-- CreateIndex
CREATE INDEX "idx_inventory_category" ON "inventory"("category");

-- CreateIndex
CREATE INDEX "idx_inventory_hotel_id" ON "inventory"("hotel_id");

-- CreateIndex
CREATE INDEX "idx_inventory_supplier" ON "inventory"("supplier_id");

-- CreateIndex
CREATE INDEX "idx_menu_category_hotel_id" ON "menu_category"("hotel_id");

-- CreateIndex
CREATE INDEX "idx_menu_category_order" ON "menu_category"("hotel_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "uq_menu_category_name" ON "menu_category"("hotel_id", "name");

-- CreateIndex
CREATE INDEX "idx_menu_item_availability" ON "menu_item"("hotel_id", "is_available");

-- CreateIndex
CREATE INDEX "idx_menu_item_category_id" ON "menu_item"("category_id");

-- CreateIndex
CREATE INDEX "idx_menu_item_hotel_id" ON "menu_item"("hotel_id");

-- CreateIndex
CREATE INDEX "idx_notification_created_at" ON "notification"("created_at");

-- CreateIndex
CREATE INDEX "idx_notification_unread" ON "notification"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "idx_notification_user_id" ON "notification"("user_id");

-- CreateIndex
CREATE INDEX "idx_order_item_menu_item_id" ON "order_item"("menu_item_id");

-- CreateIndex
CREATE INDEX "idx_order_item_order_id" ON "order_item"("order_id");

-- CreateIndex
CREATE INDEX "idx_orders_captain_id" ON "orders"("captain_id");

-- CreateIndex
CREATE INDEX "idx_orders_created_at" ON "orders"("hotel_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_orders_hotel_id" ON "orders"("hotel_id");

-- CreateIndex
CREATE INDEX "idx_orders_room_booking_id" ON "orders"("room_booking_id");

-- CreateIndex
CREATE INDEX "idx_orders_status" ON "orders"("hotel_id", "status");

-- CreateIndex
CREATE INDEX "idx_orders_table_id" ON "orders"("table_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_orders_order_number" ON "orders"("hotel_id", "order_number");

-- CreateIndex
CREATE UNIQUE INDEX "uq_qr_code" ON "qr_code"("code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_qr_code_room" ON "qr_code"("room_id") WHERE (room_id IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "uq_qr_code_dining_table" ON "qr_code"("dining_table_id") WHERE (dining_table_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "idx_qr_code_dining_table_id" ON "qr_code"("dining_table_id");

-- CreateIndex
CREATE INDEX "idx_qr_code_hotel_id" ON "qr_code"("hotel_id");

-- CreateIndex
CREATE INDEX "idx_qr_code_room_id" ON "qr_code"("room_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_name_key" ON "role"("name");

-- CreateIndex
CREATE INDEX "idx_room_hotel_id" ON "room"("hotel_id");

-- CreateIndex
CREATE INDEX "idx_room_status" ON "room"("hotel_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_room_number" ON "room"("hotel_id", "room_number");

-- CreateIndex
CREATE INDEX "idx_room_booking_created_at" ON "room_booking"("created_at");

-- CreateIndex
CREATE INDEX "idx_room_booking_customer_id" ON "room_booking"("customer_id");

-- CreateIndex
CREATE INDEX "idx_room_booking_dates" ON "room_booking"("room_id", "booking_from", "booking_to");

-- CreateIndex
CREATE INDEX "idx_room_booking_hotel_id" ON "room_booking"("hotel_id");

-- CreateIndex
CREATE INDEX "idx_room_booking_room_id" ON "room_booking"("room_id");

-- CreateIndex
CREATE INDEX "idx_room_booking_status" ON "room_booking"("hotel_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_room_booking_number" ON "room_booking"("hotel_id", "booking_number");

-- CreateIndex
CREATE INDEX "idx_tax_slab_active" ON "tax_slab"("hotel_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_tax_slab_hotel_id" ON "tax_slab"("hotel_id");

-- CreateIndex
CREATE INDEX "idx_user_role_hotel_id" ON "user_role"("hotel_id");

-- CreateIndex
CREATE INDEX "idx_user_role_role_id" ON "user_role"("role_id");

-- CreateIndex
CREATE INDEX "idx_user_role_user_id" ON "user_role"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_role_global" ON "user_role"("user_id", "role_id") WHERE (hotel_id IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_role_hotel" ON "user_role"("hotel_id", "user_id", "role_id") WHERE (hotel_id IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_users_active" ON "users"("is_active");

-- CreateIndex
CREATE INDEX "idx_users_role_email" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_vendor_active" ON "vendor"("hotel_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_vendor_category" ON "vendor"("category");

-- CreateIndex
CREATE INDEX "idx_vendor_hotel_id" ON "vendor"("hotel_id");

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dining_area" ADD CONSTRAINT "dining_area_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dining_table" ADD CONSTRAINT "dining_table_dining_area_id_fkey" FOREIGN KEY ("dining_area_id") REFERENCES "dining_area"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dining_table" ADD CONSTRAINT "dining_table_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "discount" ADD CONSTRAINT "discount_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "discount_menu_category" ADD CONSTRAINT "discount_menu_category_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "menu_category"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "discount_menu_category" ADD CONSTRAINT "discount_menu_category_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discount"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "discount_menu_item" ADD CONSTRAINT "discount_menu_item_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discount"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "discount_menu_item" ADD CONSTRAINT "discount_menu_item_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_item"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "menu_category" ADD CONSTRAINT "menu_category_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "menu_category"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_item"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_captain_id_fkey" FOREIGN KEY ("captain_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_room_booking_id_fkey" FOREIGN KEY ("room_booking_id") REFERENCES "room_booking"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "dining_table"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "qr_code" ADD CONSTRAINT "qr_code_dining_table_id_fkey" FOREIGN KEY ("dining_table_id") REFERENCES "dining_table"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "qr_code" ADD CONSTRAINT "qr_code_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "qr_code" ADD CONSTRAINT "qr_code_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room" ADD CONSTRAINT "room_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_booking" ADD CONSTRAINT "room_booking_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_booking" ADD CONSTRAINT "room_booking_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_booking" ADD CONSTRAINT "room_booking_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tax_slab" ADD CONSTRAINT "tax_slab_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
