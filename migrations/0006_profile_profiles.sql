CREATE SCHEMA "profile";
--> statement-breakpoint
CREATE TABLE "profile"."profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"full_name" text,
	"birth_date" date,
	"gender" text,
	"hometown" text,
	"current_city" text,
	"education" text,
	"occupation" text,
	"bio" text,
	"interests" text[] NOT NULL,
	"income_range_enc" "bytea",
	"housing_enc" "bytea",
	"assets_enc" "bytea",
	"photo_keys" text[] NOT NULL,
	"status" text NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "profiles_gender_ck" CHECK ("profile"."profiles"."gender" in ('male', 'female')),
	CONSTRAINT "profiles_education_ck" CHECK ("profile"."profiles"."education" in ('high_school', 'college', 'bachelor', 'master', 'doctorate')),
	CONSTRAINT "profiles_status_ck" CHECK ("profile"."profiles"."status" in ('DRAFT', 'COMPLETED')),
	CONSTRAINT "profiles_photo_keys_ck" CHECK (cardinality("profile"."profiles"."photo_keys") <= 5),
	CONSTRAINT "profiles_bio_ck" CHECK (char_length("profile"."profiles"."bio") <= 800)
);
