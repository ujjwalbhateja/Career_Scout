CREATE TABLE `career_visitor_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `career_visitor_sessions_owner_unique` ON `career_visitor_sessions` (`owner`);--> statement-breakpoint
CREATE INDEX `career_visitor_expiry` ON `career_visitor_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `career_visitor_usage` (
	`bucket` text PRIMARY KEY NOT NULL,
	`used` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `career_visitor_usage_expiry` ON `career_visitor_usage` (`expires_at`);