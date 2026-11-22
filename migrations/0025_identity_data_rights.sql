CREATE TABLE "identity"."account_deletions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "account_deletions_user_id_uq" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "identity"."data_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"ready_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"payload_enc" "bytea",
	"version" integer NOT NULL,
	CONSTRAINT "data_exports_status_ck" CHECK ("identity"."data_exports"."status" in ('PENDING', 'READY')),
	CONSTRAINT "data_exports_ready_ck" CHECK (("identity"."data_exports"."status" = 'READY') = ("identity"."data_exports"."ready_at" is not null and "identity"."data_exports"."expires_at" is not null)),
	CONSTRAINT "data_exports_payload_ck" CHECK ("identity"."data_exports"."payload_enc" is null or "identity"."data_exports"."status" = 'READY')
);
--> statement-breakpoint
ALTER TABLE "identity"."users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "data_exports_pending_per_user_uq" ON "identity"."data_exports" USING btree ("user_id") WHERE "identity"."data_exports"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "data_exports_user_id_idx" ON "identity"."data_exports" USING btree ("user_id","requested_at");--> statement-breakpoint
CREATE INDEX "data_exports_expires_at_idx" ON "identity"."data_exports" USING btree ("expires_at") WHERE "identity"."data_exports"."payload_enc" is not null;