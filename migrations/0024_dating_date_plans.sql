CREATE SCHEMA "dating";
--> statement-breakpoint
CREATE TABLE "dating"."date_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"inviter_id" uuid NOT NULL,
	"invitee_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"staff_booking_requested" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "date_plans_distinct_users_ck" CHECK ("dating"."date_plans"."inviter_id" <> "dating"."date_plans"."invitee_id"),
	CONSTRAINT "date_plans_status_ck" CHECK ("dating"."date_plans"."status" in ('PROPOSED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'DECLINED', 'EXPIRED', 'CANCELLED')),
	CONSTRAINT "date_plans_time_range_ck" CHECK ("dating"."date_plans"."ends_at" > "dating"."date_plans"."starts_at"),
	CONSTRAINT "date_plans_expiry_ck" CHECK ("dating"."date_plans"."expires_at" > "dating"."date_plans"."proposed_at" and "dating"."date_plans"."expires_at" <= "dating"."date_plans"."starts_at"),
	CONSTRAINT "date_plans_cancelled_state_ck" CHECK (("dating"."date_plans"."status" = 'CANCELLED') = ("dating"."date_plans"."cancelled_at" is not null and "dating"."date_plans"."cancelled_by" is not null)),
	CONSTRAINT "date_plans_version_ck" CHECK ("dating"."date_plans"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "date_plans_open_per_match_uq" ON "dating"."date_plans" USING btree ("match_id") WHERE "dating"."date_plans"."status" in ('PROPOSED', 'CONFIRMED', 'CHECKED_IN');--> statement-breakpoint
CREATE INDEX "date_plans_match_idx" ON "dating"."date_plans" USING btree ("match_id","proposed_at");