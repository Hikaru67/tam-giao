ALTER TABLE "matching"."candidate_profiles" ADD COLUMN "own_religion" text;--> statement-breakpoint
ALTER TABLE "matching"."candidate_profiles" ADD COLUMN "own_children_plan" text;--> statement-breakpoint
ALTER TABLE "profile"."profiles" ADD COLUMN "religion" text;--> statement-breakpoint
ALTER TABLE "profile"."profiles" ADD COLUMN "children_plan" text;--> statement-breakpoint
ALTER TABLE "matching"."candidate_profiles" ADD CONSTRAINT "candidate_profiles_own_religion_ck" CHECK ("matching"."candidate_profiles"."own_religion" in ('none', 'buddhism', 'catholicism', 'protestantism', 'caodaism', 'hoa_hao', 'other'));--> statement-breakpoint
ALTER TABLE "matching"."candidate_profiles" ADD CONSTRAINT "candidate_profiles_own_children_plan_ck" CHECK ("matching"."candidate_profiles"."own_children_plan" in ('want_children', 'no_children', 'open'));--> statement-breakpoint
ALTER TABLE "profile"."profiles" ADD CONSTRAINT "profiles_religion_ck" CHECK ("profile"."profiles"."religion" in ('none', 'buddhism', 'catholicism', 'protestantism', 'caodaism', 'hoa_hao', 'other'));--> statement-breakpoint
ALTER TABLE "profile"."profiles" ADD CONSTRAINT "profiles_children_plan_ck" CHECK ("profile"."profiles"."children_plan" in ('want_children', 'no_children', 'open'));