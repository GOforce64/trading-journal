CREATE TABLE `scalp_details` (
	`trade_id` text PRIMARY KEY NOT NULL,
	`level_basis` text NOT NULL,
	`stop_price` real,
	`target_price` real,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `trades` ADD `reviewed_at` integer;