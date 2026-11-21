CREATE SCHEMA "messaging";
--> statement-breakpoint
CREATE TABLE "messaging"."conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"status" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "conversations_match_id_uq" UNIQUE("match_id"),
	CONSTRAINT "conversations_distinct_users_ck" CHECK ("messaging"."conversations"."user_a" <> "messaging"."conversations"."user_b"),
	CONSTRAINT "conversations_status_ck" CHECK ("messaging"."conversations"."status" in ('OPEN', 'CLOSED')),
	CONSTRAINT "conversations_close_reason_ck" CHECK ("messaging"."conversations"."close_reason" in ('MATCH_CLOSED', 'MATCH_LOCKED')),
	CONSTRAINT "conversations_closed_state_ck" CHECK (("messaging"."conversations"."status" = 'CLOSED') = ("messaging"."conversations"."closed_at" is not null and "messaging"."conversations"."close_reason" is not null)),
	CONSTRAINT "conversations_period_ck" CHECK ("messaging"."conversations"."closes_at" >= "messaging"."conversations"."opened_at"),
	CONSTRAINT "conversations_version_ck" CHECK ("messaging"."conversations"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "messaging"."messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid,
	"kind" text NOT NULL,
	"system_code" text,
	"body" text NOT NULL,
	"masked_body" text,
	"flagged" boolean DEFAULT false NOT NULL,
	"flag_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "messages_kind_ck" CHECK ("messaging"."messages"."kind" in ('TEXT', 'IMAGE', 'SYSTEM')),
	CONSTRAINT "messages_system_code_ck" CHECK ("messaging"."messages"."system_code" in ('CONVERSATION_OPENED', 'CONVERSATION_CLOSED')),
	CONSTRAINT "messages_system_shape_ck" CHECK (("messaging"."messages"."kind" = 'SYSTEM') = ("messaging"."messages"."sender_id" is null) and ("messaging"."messages"."kind" = 'SYSTEM') = ("messaging"."messages"."system_code" is not null)),
	CONSTRAINT "messages_flag_reasons_ck" CHECK ("messaging"."messages"."flagged" = (cardinality("messaging"."messages"."flag_reasons") > 0))
);
--> statement-breakpoint
ALTER TABLE "messaging"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "messaging"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_user_a_idx" ON "messaging"."conversations" USING btree ("user_a");--> statement-breakpoint
CREATE INDEX "conversations_user_b_idx" ON "messaging"."conversations" USING btree ("user_b");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_idx" ON "messaging"."messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "messages_rate_limit_idx" ON "messaging"."messages" USING btree ("conversation_id","sender_id","sent_at");