CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`broker` text DEFAULT 'ibkr' NOT NULL,
	`kind` text NOT NULL,
	`external_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `iron_fly_details` (
	`trade_id` text PRIMARY KEY NOT NULL,
	`body_put_strike` real,
	`body_call_strike` real,
	`put_wing_strike` real,
	`call_wing_strike` real,
	`contracts` integer,
	`credit_per_share` real,
	`net_cost` real,
	`earnings_date` text,
	`earnings_timing` text,
	`implied_move_pct` real,
	`actual_move_pct` real,
	`iv_before` real,
	`iv_after` real,
	`source_notes` text,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `legs` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`right` text NOT NULL,
	`strike` real NOT NULL,
	`expiry` text NOT NULL,
	`quantity` integer NOT NULL,
	`multiplier` integer DEFAULT 100 NOT NULL,
	`open_price` real NOT NULL,
	`close_price` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `legs_trade_idx` ON `legs` (`trade_id`);--> statement-breakpoint
CREATE TABLE `setups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`strategy` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_kind_name_idx` ON `tags` (`kind`,`name`);--> statement-breakpoint
CREATE TABLE `trade_tags` (
	`trade_id` text NOT NULL,
	`tag_id` text NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_tags_pk` ON `trade_tags` (`trade_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`strategy` text NOT NULL,
	`book` text NOT NULL,
	`account_id` text,
	`underlying` text NOT NULL,
	`underlying_name` text,
	`structure_label` text,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`net_pnl` real,
	`fees` real DEFAULT 0 NOT NULL,
	`notes` text,
	`grade` text,
	`setup_id` text,
	`excluded` integer DEFAULT false NOT NULL,
	`exclude_reason` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`external_ref` text,
	`import_batch_id` text,
	`edited_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`setup_id`) REFERENCES `setups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trades_opened_at_idx` ON `trades` (`opened_at`);--> statement-breakpoint
CREATE INDEX `trades_strategy_book_idx` ON `trades` (`strategy`,`book`);--> statement-breakpoint
CREATE INDEX `trades_underlying_idx` ON `trades` (`underlying`);