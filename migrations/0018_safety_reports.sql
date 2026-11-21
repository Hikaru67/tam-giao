CREATE SCHEMA "safety";
--> statement-breakpoint
CREATE TABLE "safety"."reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reported_user_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"description" text,
	"evidence_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"urgent" boolean NOT NULL,
	"due_at" timestamp with time zone,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "reports_distinct_users_ck" CHECK ("safety"."reports"."reporter_id" <> "safety"."reports"."reported_user_id"),
	CONSTRAINT "reports_category_ck" CHECK ("safety"."reports"."category" in ('MARITAL_FRAUD', 'FINANCIAL_SCAM', 'HARASSMENT', 'NO_SHOW_DISRESPECT')),
	CONSTRAINT "reports_severity_ck" CHECK ("safety"."reports"."severity" in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
	CONSTRAINT "reports_status_ck" CHECK ("safety"."reports"."status" in ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')),
	CONSTRAINT "reports_description_length_ck" CHECK (char_length("safety"."reports"."description") <= 1000),
	CONSTRAINT "reports_evidence_count_ck" CHECK (cardinality("safety"."reports"."evidence_keys") <= 5),
	CONSTRAINT "reports_urgent_due_at_ck" CHECK ("safety"."reports"."urgent" = ("safety"."reports"."due_at" is not null)),
	CONSTRAINT "reports_version_ck" CHECK ("safety"."reports"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX "reports_reporter_id_idx" ON "safety"."reports" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "reports_reported_user_id_idx" ON "safety"."reports" USING btree ("reported_user_id");--> statement-breakpoint
CREATE INDEX "reports_status_due_at_idx" ON "safety"."reports" USING btree ("status","due_at");