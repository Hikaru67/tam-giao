CREATE SCHEMA "matching";
--> statement-breakpoint
CREATE TABLE "matching"."active_slots" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matching"."cooldowns" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matching"."pair_history" (
	"user_low" uuid NOT NULL,
	"user_high" uuid NOT NULL,
	"last_outcome" text NOT NULL,
	"last_match_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pair_history_pk" PRIMARY KEY("user_low","user_high"),
	CONSTRAINT "pair_history_order_ck" CHECK ("matching"."pair_history"."user_low" < "matching"."pair_history"."user_high")
);
--> statement-breakpoint
CREATE INDEX "active_slots_match_id_idx" ON "matching"."active_slots" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "pair_history_user_high_idx" ON "matching"."pair_history" USING btree ("user_high");