CREATE TABLE "matching"."candidate_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"gender" text,
	"birth_date" date,
	"city_key" text,
	"education" text,
	"children_plan" text,
	"religion" text,
	"pref_age_min" integer,
	"pref_age_max" integer,
	"pref_city_key" text,
	"pref_min_education" text,
	"scoring" jsonb,
	"profile_version" integer,
	"preferences_version" integer,
	"profile_synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "candidate_profiles_profile_complete_ck" CHECK (num_nulls("matching"."candidate_profiles"."profile_synced_at", "matching"."candidate_profiles"."gender", "matching"."candidate_profiles"."birth_date", "matching"."candidate_profiles"."city_key", "matching"."candidate_profiles"."education", "matching"."candidate_profiles"."children_plan",
        "matching"."candidate_profiles"."religion", "matching"."candidate_profiles"."pref_age_min", "matching"."candidate_profiles"."pref_age_max", "matching"."candidate_profiles"."scoring", "matching"."candidate_profiles"."profile_version", "matching"."candidate_profiles"."preferences_version")
        in (0, 12)),
	CONSTRAINT "candidate_profiles_gender_ck" CHECK ("matching"."candidate_profiles"."gender" in ('male', 'female')),
	CONSTRAINT "candidate_profiles_education_ck" CHECK ("matching"."candidate_profiles"."education" in ('high_school', 'college', 'bachelor', 'master', 'doctorate')),
	CONSTRAINT "candidate_profiles_pref_min_education_ck" CHECK ("matching"."candidate_profiles"."pref_min_education" in ('high_school', 'college', 'bachelor', 'master', 'doctorate')),
	CONSTRAINT "candidate_profiles_children_plan_ck" CHECK ("matching"."candidate_profiles"."children_plan" in ('want_children', 'no_children', 'open', 'not_important')),
	CONSTRAINT "candidate_profiles_religion_ck" CHECK ("matching"."candidate_profiles"."religion" in ('none', 'buddhism', 'catholicism', 'protestantism', 'caodaism', 'hoa_hao', 'other', 'not_important')),
	CONSTRAINT "candidate_profiles_pref_age_ck" CHECK ("matching"."candidate_profiles"."pref_age_min" <= "matching"."candidate_profiles"."pref_age_max")
);
--> statement-breakpoint
CREATE INDEX "candidate_profiles_ready_idx" ON "matching"."candidate_profiles" USING btree ("birth_date") WHERE "matching"."candidate_profiles"."verified" and "matching"."candidate_profiles"."profile_synced_at" is not null;