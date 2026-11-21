CREATE SCHEMA "billing";
--> statement-breakpoint
CREATE TABLE "billing"."partner_staff" (
	"id" uuid PRIMARY KEY NOT NULL,
	"partner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"pin_hash" text NOT NULL,
	"device_id" text,
	"active" boolean NOT NULL,
	"failed_logins" integer NOT NULL,
	"locked_until" timestamp with time zone,
	"token_version" integer NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "partner_staff_failed_logins_ck" CHECK ("billing"."partner_staff"."failed_logins" >= 0),
	CONSTRAINT "partner_staff_token_version_ck" CHECK ("billing"."partner_staff"."token_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "billing"."partners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"photo_url" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "partners_name_ck" CHECK (length("billing"."partners"."name") between 1 and 120),
	CONSTRAINT "partners_address_ck" CHECK (length("billing"."partners"."address") between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "billing"."partner_staff" ADD CONSTRAINT "partner_staff_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "billing"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_staff_partner_id_idx" ON "billing"."partner_staff" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "partners_active_name_idx" ON "billing"."partners" USING btree ("active","name");