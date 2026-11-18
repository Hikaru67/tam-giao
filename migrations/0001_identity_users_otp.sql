CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE TABLE "identity"."otp_challenges" (
	"phone_bidx" text PRIMARY KEY NOT NULL,
	"id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"failed_attempts" integer NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."rate_limit_hits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"hit_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone_enc" "bytea" NOT NULL,
	"phone_bidx" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_phone_bidx_uq" UNIQUE("phone_bidx")
);
--> statement-breakpoint
CREATE INDEX "rate_limit_hits_key_hit_at_idx" ON "identity"."rate_limit_hits" USING btree ("key","hit_at");