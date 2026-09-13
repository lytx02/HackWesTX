CREATE TABLE IF NOT EXISTS "agent_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"base_prompt" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "agent_instructions" text;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "instructions_updated_by" uuid;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "instructions_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "canvas_course_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "canvas_user_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "classes" ADD CONSTRAINT "classes_instructions_updated_by_users_id_fk" FOREIGN KEY ("instructions_updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
