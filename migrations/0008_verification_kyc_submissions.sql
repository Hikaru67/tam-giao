CREATE SCHEMA "verification";
--> statement-breakpoint
CREATE TABLE "verification"."kyc_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"steps" jsonb NOT NULL,
	"cccd_number_enc" "bytea",
	"cccd_number_bidx" text,
	"cccd_front_key" text,
	"cccd_back_key" text,
	"selfie_key" text,
	"marital_status_certificate_key" text,
	"ekyc_assessment" jsonb,
	"reviewer_id" uuid,
	"more_info_request" jsonb,
	"rejection_code" text,
	"rejection_note" text,
	"decided_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "kyc_submissions_user_id_uq" UNIQUE("user_id"),
	CONSTRAINT "kyc_submissions_cccd_number_bidx_uq" UNIQUE("cccd_number_bidx"),
	CONSTRAINT "kyc_submissions_status_ck" CHECK ("verification"."kyc_submissions"."status" in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO', 'APPROVED', 'REJECTED')),
	CONSTRAINT "kyc_submissions_cccd_pair_ck" CHECK (("verification"."kyc_submissions"."cccd_number_enc" is null) = ("verification"."kyc_submissions"."cccd_number_bidx" is null)),
	CONSTRAINT "kyc_submissions_rejection_ck" CHECK (("verification"."kyc_submissions"."status" = 'REJECTED') = ("verification"."kyc_submissions"."rejection_code" is not null))
);
--> statement-breakpoint
CREATE INDEX "kyc_submissions_status_submitted_idx" ON "verification"."kyc_submissions" USING btree ("status","submitted_at");