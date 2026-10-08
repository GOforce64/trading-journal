CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`sha256` text NOT NULL,
	`ext` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`caption` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attachments_trade_idx` ON `attachments` (`trade_id`);