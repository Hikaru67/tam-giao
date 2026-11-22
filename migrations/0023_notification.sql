CREATE SCHEMA "notification";
--> statement-breakpoint
CREATE TABLE "notification"."deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid NOT NULL,
	"aggregate_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"status" text NOT NULL,
	"channel" text,
	"skip_reason" text,
	"send_after" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "deliveries_event_user_kind_uq" UNIQUE("event_id","user_id","kind"),
	CONSTRAINT "deliveries_status_ck" CHECK ("notification"."deliveries"."status" in ('PENDING', 'SENT', 'SKIPPED', 'FAILED', 'CANCELLED')),
	CONSTRAINT "deliveries_channel_ck" CHECK ("notification"."deliveries"."channel" in ('PUSH', 'SMS')),
	CONSTRAINT "deliveries_sent_ck" CHECK (("notification"."deliveries"."status" = 'SENT') = ("notification"."deliveries"."channel" is not null and "notification"."deliveries"."sent_at" is not null)),
	CONSTRAINT "deliveries_skip_reason_ck" CHECK (("notification"."deliveries"."status" in ('SKIPPED', 'FAILED')) = ("notification"."deliveries"."skip_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "notification"."devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "devices_token_uq" UNIQUE("token"),
	CONSTRAINT "devices_platform_ck" CHECK ("notification"."devices"."platform" in ('ios', 'android'))
);
--> statement-breakpoint
CREATE TABLE "notification"."preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"matches" boolean NOT NULL,
	"messages" boolean NOT NULL,
	"dates" boolean NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deliveries_aggregate_kind_idx" ON "notification"."deliveries" USING btree ("aggregate_id","kind");--> statement-breakpoint
CREATE INDEX "deliveries_user_id_idx" ON "notification"."deliveries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "devices_user_id_idx" ON "notification"."devices" USING btree ("user_id");