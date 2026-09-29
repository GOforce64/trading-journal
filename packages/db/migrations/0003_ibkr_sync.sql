CREATE TABLE `fills` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`broker_exec_key` text NOT NULL,
	`broker_trade_id` text NOT NULL,
	`broker_order_id` text,
	`conid` text NOT NULL,
	`underlying` text NOT NULL,
	`right` text NOT NULL,
	`strike` real NOT NULL,
	`expiry` text NOT NULL,
	`multiplier` integer NOT NULL,
	`trade_date` text NOT NULL,
	`executed_at` integer NOT NULL,
	`quantity` integer NOT NULL,
	`price` real NOT NULL,
	`commission` real NOT NULL,
	`open_close` text,
	`kind` text NOT NULL,
	`origin` text NOT NULL,
	`canceled` integer DEFAULT false NOT NULL,
	`trade_id` text,
	`leg_id` text,
	`raw` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fills_account_time_idx` ON `fills` (`account_id`,`executed_at`);--> statement-breakpoint
CREATE INDEX `fills_trade_idx` ON `fills` (`trade_id`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`source` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`last_run_at` integer NOT NULL,
	`last_status` text NOT NULL,
	`last_error` text,
	`last_summary` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `trades` ADD `facts_edited_at` integer;