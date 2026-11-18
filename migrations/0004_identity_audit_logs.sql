CREATE TABLE "identity"."audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"ip" text,
	"meta" jsonb NOT NULL,
	CONSTRAINT "audit_logs_actor_type_ck" CHECK ("identity"."audit_logs"."actor_type" in ('admin', 'user', 'system')),
	CONSTRAINT "audit_logs_actor_id_ck" CHECK (("identity"."audit_logs"."actor_type" = 'system' and "identity"."audit_logs"."actor_id" is null) or ("identity"."audit_logs"."actor_type" <> 'system' and "identity"."audit_logs"."actor_id" is not null))
);
--> statement-breakpoint
CREATE INDEX "audit_logs_occurred_at_idx" ON "identity"."audit_logs" USING btree ("occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "identity"."audit_logs" USING btree ("actor_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "identity"."audit_logs" USING btree ("target_type","target_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
-- Viết tay (BE-S2-04): audit_logs chỉ ghi thêm. App hiện kết nối bằng role owner của bảng (owner luôn
-- tự cấp lại được quyền, superuser bỏ qua quyền) nên REVOKE thôi là chưa đủ → trigger cấp câu lệnh chặn
-- mọi UPDATE/DELETE với bất kỳ role nào, kể cả câu lệnh không khớp dòng nào.
CREATE FUNCTION "identity"."audit_logs_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'identity.audit_logs is append-only: % is not allowed', TG_OP
		USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "identity"."audit_logs"
	FOR EACH STATEMENT EXECUTE FUNCTION "identity"."audit_logs_append_only"();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "identity"."audit_logs" FROM PUBLIC;
