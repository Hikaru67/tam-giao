CREATE TABLE "platform"."uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"key" text NOT NULL,
	"bucket" text NOT NULL,
	"purpose" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "uploads_key_uq" UNIQUE("key"),
	CONSTRAINT "uploads_bucket_ck" CHECK ("platform"."uploads"."bucket" in ('publicProfile', 'privateKyc')),
	CONSTRAINT "uploads_purpose_ck" CHECK ("platform"."uploads"."purpose" in ('profile_photo', 'kyc_doc', 'kyc_selfie', 'report_evidence')),
	CONSTRAINT "uploads_status_ck" CHECK ("platform"."uploads"."status" in ('PENDING', 'CONFIRMED')),
	CONSTRAINT "uploads_size_ck" CHECK ("platform"."uploads"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE INDEX "uploads_owner_id_idx" ON "platform"."uploads" USING btree ("owner_id");