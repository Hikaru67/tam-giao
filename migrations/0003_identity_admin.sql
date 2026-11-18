CREATE TABLE "identity"."admin_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"remember_device" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "admin_sessions_token_hash_uq" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "identity"."admin_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" "bytea" NOT NULL,
	"role" text NOT NULL,
	"failed_logins" integer NOT NULL,
	"locked_until" timestamp with time zone,
	"last_totp_step" bigint,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "admin_users_email_uq" UNIQUE("email"),
	CONSTRAINT "admin_users_role_ck" CHECK ("identity"."admin_users"."role" in ('REVIEWER', 'MATCHMAKER', 'SUPERVISOR', 'ADMIN'))
);
--> statement-breakpoint
ALTER TABLE "identity"."admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "identity"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_id_idx" ON "identity"."admin_sessions" USING btree ("admin_id");