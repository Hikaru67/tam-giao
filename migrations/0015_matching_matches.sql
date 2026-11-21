CREATE TABLE "matching"."match_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "match_events_match_version_uq" UNIQUE("match_id","version")
);
--> statement-breakpoint
CREATE TABLE "matching"."matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"status" text NOT NULL,
	"accepted_by" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"score_snapshot" jsonb,
	"staff_note" text,
	"expires_at" timestamp with time zone,
	"offered_at" timestamp with time zone NOT NULL,
	"dating_started_at" timestamp with time zone,
	"met_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"declined_by" uuid,
	"decline_reason" text,
	"withdrawn" boolean DEFAULT false NOT NULL,
	"close_outcome" text,
	"lock_reason" text,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "matches_distinct_users_ck" CHECK ("matching"."matches"."user_a" <> "matching"."matches"."user_b"),
	CONSTRAINT "matches_status_ck" CHECK ("matching"."matches"."status" in ('OFFERED', 'AWAITING_RESPONSE', 'DATING', 'MET', 'CLOSED_SUCCESS', 'CLOSED_STOPPED', 'EXPIRED', 'DECLINED', 'LOCKED')),
	CONSTRAINT "matches_close_outcome_ck" CHECK ("matching"."matches"."close_outcome" in ('SUCCESS', 'STOPPED')),
	CONSTRAINT "matches_accepted_by_ck" CHECK (cardinality("matching"."matches"."accepted_by") <= 2),
	CONSTRAINT "matches_version_ck" CHECK ("matching"."matches"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "matching"."match_events" ADD CONSTRAINT "match_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "matching"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matches_user_a_idx" ON "matching"."matches" USING btree ("user_a");--> statement-breakpoint
CREATE INDEX "matches_user_b_idx" ON "matching"."matches" USING btree ("user_b");--> statement-breakpoint
-- Viết tay (BE-S5-04): match_events chỉ ghi thêm (AGENTS.md mục 4), cùng cách với billing.ledger_entries (0011):
-- app kết nối bằng role owner nên REVOKE thôi chưa đủ → trigger cấp câu lệnh chặn mọi UPDATE/DELETE với mọi role.
CREATE FUNCTION "matching"."match_events_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'matching.match_events is append-only: % is not allowed', TG_OP
		USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "match_events_append_only" BEFORE UPDATE OR DELETE ON "matching"."match_events"
	FOR EACH STATEMENT EXECUTE FUNCTION "matching"."match_events_append_only"();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "matching"."match_events" FROM PUBLIC;
