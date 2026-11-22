CREATE TABLE "dating"."check_in_locations" (
	"check_in_id" uuid PRIMARY KEY NOT NULL,
	"location_enc" "bytea" NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"purge_after" timestamp with time zone NOT NULL,
	CONSTRAINT "check_in_locations_purge_after_ck" CHECK ("dating"."check_in_locations"."purge_after" > "dating"."check_in_locations"."recorded_at")
);
--> statement-breakpoint
CREATE TABLE "dating"."safety_check_ins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"date_plan_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"source" text NOT NULL,
	"checked_in_at" timestamp with time zone NOT NULL,
	"date_ends_at" timestamp with time zone NOT NULL,
	"overdue_at" timestamp with time zone NOT NULL,
	"checked_out_at" timestamp with time zone,
	"overdue_alerted_at" timestamp with time zone,
	"location_shared" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "safety_check_ins_source_ck" CHECK ("dating"."safety_check_ins"."source" in ('MANUAL', 'VOUCHER')),
	CONSTRAINT "safety_check_ins_overdue_ck" CHECK ("dating"."safety_check_ins"."overdue_at" > "dating"."safety_check_ins"."date_ends_at"),
	CONSTRAINT "safety_check_ins_checkout_ck" CHECK ("dating"."safety_check_ins"."checked_out_at" is null or "dating"."safety_check_ins"."checked_out_at" >= "dating"."safety_check_ins"."checked_in_at"),
	CONSTRAINT "safety_check_ins_version_ck" CHECK ("dating"."safety_check_ins"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "dating"."check_in_locations" ADD CONSTRAINT "check_in_locations_check_in_id_safety_check_ins_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "dating"."safety_check_ins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dating"."safety_check_ins" ADD CONSTRAINT "safety_check_ins_date_plan_id_date_plans_id_fk" FOREIGN KEY ("date_plan_id") REFERENCES "dating"."date_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_in_locations_purge_after_idx" ON "dating"."check_in_locations" USING btree ("purge_after");--> statement-breakpoint
CREATE UNIQUE INDEX "safety_check_ins_plan_user_uq" ON "dating"."safety_check_ins" USING btree ("date_plan_id","user_id");--> statement-breakpoint
CREATE INDEX "safety_check_ins_user_idx" ON "dating"."safety_check_ins" USING btree ("user_id");