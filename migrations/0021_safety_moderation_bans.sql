CREATE TABLE "identity"."banned_users" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"banned_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety"."user_bans" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"id" uuid NOT NULL,
	"reason" text NOT NULL,
	"report_id" uuid,
	"banned_by" uuid NOT NULL,
	"banned_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "user_bans_id_uq" UNIQUE("id"),
	CONSTRAINT "user_bans_reason_length_ck" CHECK (char_length("safety"."user_bans"."reason") between 1 and 1000),
	CONSTRAINT "user_bans_version_ck" CHECK ("safety"."user_bans"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "safety"."reports" ADD COLUMN "handled_by" uuid;--> statement-breakpoint
ALTER TABLE "safety"."reports" ADD COLUMN "conclusion" text;--> statement-breakpoint
ALTER TABLE "safety"."user_bans" ADD CONSTRAINT "user_bans_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "safety"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety"."reports" ADD CONSTRAINT "reports_conclusion_length_ck" CHECK (char_length("safety"."reports"."conclusion") <= 2000);--> statement-breakpoint
ALTER TABLE "safety"."reports" ADD CONSTRAINT "reports_closed_at_ck" CHECK (("safety"."reports"."status" in ('RESOLVED', 'DISMISSED')) = ("safety"."reports"."closed_at" is not null));