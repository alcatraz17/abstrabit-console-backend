CREATE TABLE "admin_guilds" (
	"admin_id" uuid NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"role" varchar(20) DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_guilds_admin_id_guild_id_pk" PRIMARY KEY("admin_id","guild_id")
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "command_configs" (
	"guild_id" varchar(20) NOT NULL,
	"command" varchar(32) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "command_configs_guild_id_command_pk" PRIMARY KEY("guild_id","command")
);
--> statement-breakpoint
CREATE TABLE "connect_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"admin_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_guild_id" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connect_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"level" varchar(10) DEFAULT 'info' NOT NULL,
	"type" varchar(40) NOT NULL,
	"guild_id" varchar(20),
	"interaction_id" varchar(20),
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'connected' NOT NULL,
	"attention_reason" text,
	"post_channel_id" varchar(20),
	"mirror_kind" varchar(10) DEFAULT 'none' NOT NULL,
	"mirror_url_enc" text,
	"settings" jsonb DEFAULT '{"mirrorOutage":false,"slowAi":false}'::jsonb NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interactions" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"guild_id" varchar(20),
	"channel_id" varchar(20),
	"user_id" varchar(20),
	"user_name" varchar(100),
	"kind" varchar(20) NOT NULL,
	"command" varchar(32) NOT NULL,
	"custom_id" varchar(100),
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config_snapshot" jsonb,
	"config_version" integer,
	"token_enc" text,
	"token_expires_at" timestamp with time zone,
	"decision" jsonb,
	"ai" jsonb,
	"report_id" integer,
	"status" varchar(20) DEFAULT 'received' NOT NULL,
	"ack_ms" integer,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"outcome" varchar(20) NOT NULL,
	"http_status" integer,
	"discord_code" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interaction_id" varchar(20) NOT NULL,
	"guild_id" varchar(20),
	"kind" varchar(32) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"lease_token" uuid,
	"deadline_at" timestamp with time zone,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_interaction_kind_unique" UNIQUE("interaction_id","kind")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"interaction_id" varchar(20) NOT NULL,
	"author_id" varchar(20) NOT NULL,
	"author_name" varchar(100) NOT NULL,
	"text" text NOT NULL,
	"severity" varchar(10),
	"priority" varchar(10) NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_summary" text,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"handled_by_id" varchar(20),
	"handled_by_name" varchar(100),
	"handled_at" timestamp with time zone,
	"channel_id" varchar(20),
	"channel_message_id" varchar(20),
	"mirror_message_id" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_interaction_id_unique" UNIQUE("interaction_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_guilds" ADD CONSTRAINT "admin_guilds_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_guilds" ADD CONSTRAINT "admin_guilds_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_configs" ADD CONSTRAINT "command_configs_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_configs" ADD CONSTRAINT "command_configs_updated_by_admins_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connect_codes" ADD CONSTRAINT "connect_codes_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_connected_by_admins_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_attempts" ADD CONSTRAINT "job_attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_interaction_id_interactions_id_fk" FOREIGN KEY ("interaction_id") REFERENCES "public"."interactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_interaction_id_interactions_id_fk" FOREIGN KEY ("interaction_id") REFERENCES "public"."interactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connect_codes_admin_idx" ON "connect_codes" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "events_ts_idx" ON "events" USING btree ("ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_type_ts_idx" ON "events" USING btree ("type","ts");--> statement-breakpoint
CREATE INDEX "events_interaction_idx" ON "events" USING btree ("interaction_id");--> statement-breakpoint
CREATE INDEX "guilds_status_idx" ON "guilds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "interactions_guild_received_idx" ON "interactions" USING btree ("guild_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "interactions_guild_updated_idx" ON "interactions" USING btree ("guild_id","updated_at");--> statement-breakpoint
CREATE INDEX "interactions_user_received_idx" ON "interactions" USING btree ("guild_id","user_id","received_at");--> statement-breakpoint
CREATE INDEX "job_attempts_job_idx" ON "job_attempts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "jobs_status_next_idx" ON "jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "jobs_guild_status_idx" ON "jobs" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "reports_guild_status_idx" ON "reports" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "session_expire_idx" ON "session" USING btree ("expire");