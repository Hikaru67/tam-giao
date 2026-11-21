ALTER TABLE "messaging"."messages" DROP CONSTRAINT "messages_system_code_ck";--> statement-breakpoint
ALTER TABLE "messaging"."messages" ADD COLUMN "visible_to" uuid;--> statement-breakpoint
ALTER TABLE "messaging"."messages" ADD CONSTRAINT "messages_visible_to_ck" CHECK ("messaging"."messages"."visible_to" is null or "messaging"."messages"."kind" = 'SYSTEM');--> statement-breakpoint
ALTER TABLE "messaging"."messages" ADD CONSTRAINT "messages_system_code_ck" CHECK ("messaging"."messages"."system_code" in ('CONVERSATION_OPENED', 'CONVERSATION_CLOSED', 'FRAUD_WARNING'));