CREATE TABLE "dating"."feedbacks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"date_plan_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"profile_match" text NOT NULL,
	"feeling" text NOT NULL,
	"decision" text NOT NULL,
	"stop_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"stop_note" text,
	"submitted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "feedbacks_distinct_users_ck" CHECK ("dating"."feedbacks"."author_id" <> "dating"."feedbacks"."subject_id"),
	CONSTRAINT "feedbacks_rating_ck" CHECK ("dating"."feedbacks"."rating" between 1 and 5),
	CONSTRAINT "feedbacks_profile_match_ck" CHECK ("dating"."feedbacks"."profile_match" in ('FULL_MATCH', 'MOSTLY_MATCH', 'DIFFERENT')),
	CONSTRAINT "feedbacks_feeling_ck" CHECK ("dating"."feedbacks"."feeling" in ('DEEP_INTEREST', 'NEED_MORE_TIME', 'NOT_A_FIT')),
	CONSTRAINT "feedbacks_decision_ck" CHECK ("dating"."feedbacks"."decision" in ('A_COMMIT', 'B_STOP')),
	CONSTRAINT "feedbacks_stop_details_ck" CHECK (("dating"."feedbacks"."decision" = 'B_STOP') or (cardinality("dating"."feedbacks"."stop_reasons") = 0 and "dating"."feedbacks"."stop_note" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "feedbacks_match_author_uq" ON "dating"."feedbacks" USING btree ("match_id","author_id");--> statement-breakpoint
CREATE INDEX "feedbacks_appearance_flag_idx" ON "dating"."feedbacks" USING btree ("submitted_at","id") WHERE "dating"."feedbacks"."profile_match" = 'DIFFERENT';