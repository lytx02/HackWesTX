ALTER TABLE "assignments" ADD COLUMN "canvas_assignment_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "canvas_base_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "canvas_token_enc" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "canvas_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "canvas_connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "canvas_last_sync_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assignments_canvas_idx" ON "assignments" USING btree ("canvas_assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "classes_canvas_course_idx" ON "classes" USING btree ("canvas_course_id");