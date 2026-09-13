CREATE TABLE IF NOT EXISTS "conversation_daily_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"summary_day" date NOT NULL,
	"body" text NOT NULL,
	"message_count" integer NOT NULL,
	"source_through_at" timestamp with time zone,
	"source_through_message_id" uuid,
	"snapshot_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_daily_summaries_message_count_nonneg" CHECK ("conversation_daily_summaries"."message_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "digest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"generated_by" uuid,
	"window_start_day" date NOT NULL,
	"window_end_day" date NOT NULL,
	"time_zone" text NOT NULL,
	"summary_count" integer DEFAULT 0 NOT NULL,
	"student_count" integer DEFAULT 0 NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_runs_window_seven_days" CHECK ("digest_runs"."window_end_day" - "digest_runs"."window_start_day" = 6),
	CONSTRAINT "digest_runs_summary_count_nonneg" CHECK ("digest_runs"."summary_count" >= 0),
	CONSTRAINT "digest_runs_student_count_nonneg" CHECK ("digest_runs"."student_count" >= 0),
	CONSTRAINT "digest_runs_prompt_tokens_nonneg" CHECK ("digest_runs"."prompt_tokens" IS NULL OR "digest_runs"."prompt_tokens" >= 0),
	CONSTRAINT "digest_runs_completion_tokens_nonneg" CHECK ("digest_runs"."completion_tokens" IS NULL OR "digest_runs"."completion_tokens" >= 0)
);
--> statement-breakpoint
ALTER TABLE "digest_items" ADD COLUMN "digest_run_id" uuid;--> statement-breakpoint
ALTER TABLE "digest_items" ADD COLUMN "rank" integer;--> statement-breakpoint
ALTER TABLE "digest_items" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "prompt_tokens" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "completion_tokens" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "usage_source" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_usage_day" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_tokens_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_daily_summaries" ADD CONSTRAINT "conversation_daily_summaries_conversation_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "digest_runs" ADD CONSTRAINT "digest_runs_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "digest_runs" ADD CONSTRAINT "digest_runs_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_daily_summaries_conv_day_idx" ON "conversation_daily_summaries" USING btree ("conversation_id","summary_day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_daily_summaries_day_idx" ON "conversation_daily_summaries" USING btree ("summary_day","conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "digest_runs_class_idx" ON "digest_runs" USING btree ("class_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_digest_run_id_digest_runs_id_fk" FOREIGN KEY ("digest_run_id") REFERENCES "public"."digest_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "digest_items_run_rank_idx" ON "digest_items" USING btree ("digest_run_id","rank");--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_rank_range" CHECK ("digest_items"."rank" IS NULL OR ("digest_items"."rank" BETWEEN 1 AND 3));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_prompt_tokens_nonneg" CHECK ("messages"."prompt_tokens" IS NULL OR "messages"."prompt_tokens" >= 0);--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_completion_tokens_nonneg" CHECK ("messages"."completion_tokens" IS NULL OR "messages"."completion_tokens" >= 0);--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_usage_source_valid" CHECK ("messages"."usage_source" IS NULL OR "messages"."usage_source" IN ('reported', 'estimated'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_usage_agent_only" CHECK ("messages"."sender" = 'agent' OR ("messages"."prompt_tokens" IS NULL AND "messages"."completion_tokens" IS NULL AND "messages"."usage_source" IS NULL));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_ai_tokens_used_nonneg" CHECK ("users"."ai_tokens_used" >= 0);