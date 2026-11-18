CREATE TABLE "profile"."preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"age_min" integer NOT NULL,
	"age_max" integer NOT NULL,
	"area_city" text,
	"area_radius_km" integer,
	"children_plan" text NOT NULL,
	"religion" text NOT NULL,
	"min_education" text,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "preferences_age_ck" CHECK ("profile"."preferences"."age_min" >= 1 and "profile"."preferences"."age_max" <= 80 and "profile"."preferences"."age_min" <= "profile"."preferences"."age_max"),
	CONSTRAINT "preferences_radius_ck" CHECK ("profile"."preferences"."area_radius_km" is null or ("profile"."preferences"."area_radius_km" between 1 and 500)),
	CONSTRAINT "preferences_children_plan_ck" CHECK ("profile"."preferences"."children_plan" in ('want_children', 'no_children', 'open', 'not_important')),
	CONSTRAINT "preferences_religion_ck" CHECK ("profile"."preferences"."religion" in ('none', 'buddhism', 'catholicism', 'protestantism', 'caodaism', 'hoa_hao', 'other', 'not_important')),
	CONSTRAINT "preferences_min_education_ck" CHECK ("profile"."preferences"."min_education" is null or "profile"."preferences"."min_education" in ('high_school', 'college', 'bachelor', 'master', 'doctorate'))
);
--> statement-breakpoint
CREATE INDEX "preferences_age_idx" ON "profile"."preferences" USING btree ("age_min","age_max");