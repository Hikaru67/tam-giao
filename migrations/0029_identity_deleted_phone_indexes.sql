CREATE TABLE "identity"."deleted_phone_indexes" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"phone_bidx" text NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deleted_phone_indexes_phone_bidx_idx" ON "identity"."deleted_phone_indexes" USING btree ("phone_bidx");