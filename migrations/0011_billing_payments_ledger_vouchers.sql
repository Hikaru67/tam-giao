CREATE TABLE "billing"."ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"amount" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	"payment_id" uuid,
	"voucher_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ledger_entries_type_ck" CHECK ("billing"."ledger_entries"."type" in ('CHARGE', 'REFUND', 'VOUCHER_ISSUE', 'VOUCHER_REDEEM', 'VOUCHER_VOID')),
	CONSTRAINT "ledger_entries_amount_ck" CHECK ("billing"."ledger_entries"."amount" > 0),
	CONSTRAINT "ledger_entries_reference_ck" CHECK (("billing"."ledger_entries"."type" in ('CHARGE', 'REFUND') and "billing"."ledger_entries"."payment_id" is not null) or ("billing"."ledger_entries"."type" not in ('CHARGE', 'REFUND') and "billing"."ledger_entries"."voucher_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "billing"."payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"status" text NOT NULL,
	"gateway_txn_id" text,
	"idempotency_key" text NOT NULL,
	"failure_reason" text,
	"checkout_url" text,
	"qr_data" text,
	"created_at" timestamp with time zone NOT NULL,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"refund_requested_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "payments_order_id_uq" UNIQUE("order_id"),
	CONSTRAINT "payments_gateway_txn_id_uq" UNIQUE("gateway_txn_id"),
	CONSTRAINT "payments_user_id_idempotency_key_uq" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "payments_status_ck" CHECK ("billing"."payments"."status" in ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUND_PENDING', 'REFUNDED')),
	CONSTRAINT "payments_amount_ck" CHECK ("billing"."payments"."amount" > 0),
	CONSTRAINT "payments_gateway_txn_ck" CHECK (("billing"."payments"."status" in ('PENDING', 'FAILED')) = ("billing"."payments"."gateway_txn_id" is null))
);
--> statement-breakpoint
CREATE TABLE "billing"."vouchers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"value" bigint NOT NULL,
	"status" text NOT NULL,
	"partner_id" uuid,
	"expires_at" timestamp with time zone,
	"issued_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"redeemed_by_partner_id" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"expired_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "vouchers_payment_id_uq" UNIQUE("payment_id"),
	CONSTRAINT "vouchers_status_ck" CHECK ("billing"."vouchers"."status" in ('RESERVED', 'ACTIVE', 'REDEEMED', 'VOID', 'EXPIRED')),
	CONSTRAINT "vouchers_value_ck" CHECK ("billing"."vouchers"."value" > 0)
);
--> statement-breakpoint
ALTER TABLE "billing"."ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "billing"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."ledger_entries" ADD CONSTRAINT "ledger_entries_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "billing"."vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."vouchers" ADD CONSTRAINT "vouchers_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "billing"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."vouchers" ADD CONSTRAINT "vouchers_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "billing"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."vouchers" ADD CONSTRAINT "vouchers_redeemed_by_partner_id_partners_id_fk" FOREIGN KEY ("redeemed_by_partner_id") REFERENCES "billing"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_payment_type_uq" ON "billing"."ledger_entries" USING btree ("payment_id","type") WHERE "billing"."ledger_entries"."type" in ('CHARGE', 'REFUND');--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_voucher_type_uq" ON "billing"."ledger_entries" USING btree ("voucher_id","type") WHERE "billing"."ledger_entries"."voucher_id" is not null;--> statement-breakpoint
CREATE INDEX "ledger_entries_user_id_idx" ON "billing"."ledger_entries" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_occurred_at_idx" ON "billing"."ledger_entries" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_active_per_user_uq" ON "billing"."payments" USING btree ("user_id") WHERE "billing"."payments"."status" in ('PENDING', 'SUCCEEDED');--> statement-breakpoint
CREATE INDEX "payments_user_id_created_at_idx" ON "billing"."payments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "vouchers_user_id_idx" ON "billing"."vouchers" USING btree ("user_id","issued_at");--> statement-breakpoint
CREATE INDEX "vouchers_status_expires_at_idx" ON "billing"."vouchers" USING btree ("status","expires_at");--> statement-breakpoint
-- Viết tay (BE-S4-03): ledger_entries chỉ ghi thêm (AGENTS.md mục 4), cùng cách với identity.audit_logs (0004):
-- app kết nối bằng role owner nên REVOKE thôi chưa đủ → trigger cấp câu lệnh chặn mọi UPDATE/DELETE với mọi role.
CREATE FUNCTION "billing"."ledger_entries_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'billing.ledger_entries is append-only: % is not allowed', TG_OP
		USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ledger_entries_append_only" BEFORE UPDATE OR DELETE ON "billing"."ledger_entries"
	FOR EACH STATEMENT EXECUTE FUNCTION "billing"."ledger_entries_append_only"();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "billing"."ledger_entries" FROM PUBLIC;