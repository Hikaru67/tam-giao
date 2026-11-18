CREATE TABLE "verification"."interview_slots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"interviewer_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"meeting_url" text,
	"status" text NOT NULL,
	"booked_by" uuid,
	"booked_at" timestamp with time zone,
	"outcome" text,
	"notes" text,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "interview_slots_interviewer_starts_at_uq" UNIQUE("interviewer_id","starts_at"),
	CONSTRAINT "interview_slots_status_ck" CHECK ("verification"."interview_slots"."status" in ('OPEN', 'BOOKED', 'COMPLETED')),
	CONSTRAINT "interview_slots_outcome_ck" CHECK ("verification"."interview_slots"."outcome" is null or "verification"."interview_slots"."outcome" in ('PASSED', 'FAILED')),
	CONSTRAINT "interview_slots_booked_ck" CHECK (("verification"."interview_slots"."status" = 'OPEN') = ("verification"."interview_slots"."booked_by" is null)),
	CONSTRAINT "interview_slots_completed_ck" CHECK (("verification"."interview_slots"."status" = 'COMPLETED') = ("verification"."interview_slots"."outcome" is not null)),
	CONSTRAINT "interview_slots_time_ck" CHECK ("verification"."interview_slots"."ends_at" > "verification"."interview_slots"."starts_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "interview_slots_active_booking_uq" ON "verification"."interview_slots" USING btree ("booked_by") WHERE "verification"."interview_slots"."status" = 'BOOKED';--> statement-breakpoint
CREATE INDEX "interview_slots_status_starts_at_idx" ON "verification"."interview_slots" USING btree ("status","starts_at");