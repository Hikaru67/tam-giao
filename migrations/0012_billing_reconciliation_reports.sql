CREATE TABLE "billing"."reconciliation_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_date" date NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"ledger_charge_total" bigint NOT NULL,
	"ledger_refund_total" bigint NOT NULL,
	"held_payment_total" bigint NOT NULL,
	"held_payment_count" integer NOT NULL,
	"voucher_issue_entries" integer NOT NULL,
	"voucher_redeem_entries" integer NOT NULL,
	"voucher_void_entries" integer NOT NULL,
	"vouchers_reserved" integer NOT NULL,
	"vouchers_active" integer NOT NULL,
	"vouchers_redeemed" integer NOT NULL,
	"vouchers_void" integer NOT NULL,
	"vouchers_expired" integer NOT NULL,
	"mismatches" jsonb NOT NULL,
	CONSTRAINT "reconciliation_reports_report_date_uq" UNIQUE("report_date"),
	CONSTRAINT "reconciliation_reports_status_ck" CHECK ("billing"."reconciliation_reports"."status" in ('MATCHED', 'MISMATCH')),
	CONSTRAINT "reconciliation_reports_mismatches_ck" CHECK (case when jsonb_typeof("billing"."reconciliation_reports"."mismatches") = 'array' then ("billing"."reconciliation_reports"."status" = 'MATCHED') = (jsonb_array_length("billing"."reconciliation_reports"."mismatches") = 0) else false end)
);
--> statement-breakpoint
CREATE INDEX "reconciliation_reports_run_at_idx" ON "billing"."reconciliation_reports" USING btree ("run_at","id");--> statement-breakpoint
CREATE INDEX "reconciliation_reports_status_run_at_idx" ON "billing"."reconciliation_reports" USING btree ("status","run_at","id");