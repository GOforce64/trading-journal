CREATE TABLE `scalp_prices` (
	`trade_id` text PRIMARY KEY NOT NULL,
	`entry_price` real,
	`hold_high` real,
	`hold_low` real,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scalp_targets` (
	`trade_id` text NOT NULL,
	`position` integer NOT NULL,
	`price` real NOT NULL,
	`contracts` integer NOT NULL,
	PRIMARY KEY(`trade_id`, `position`),
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `scalp_details` ADD `stock_entry_override` real;--> statement-breakpoint
ALTER TABLE `scalp_details` ADD `risk_override` real;--> statement-breakpoint
INSERT INTO `scalp_targets` (`trade_id`, `position`, `price`, `contracts`)
SELECT `trade_id`, 1, `target_price`, MAX(1, COALESCE((
  SELECT SUM(ABS(`quantity`)) FROM `legs`
  WHERE `legs`.`trade_id` = `scalp_details`.`trade_id` AND `legs`.`deleted_at` IS NULL
), 1))
FROM `scalp_details` WHERE `target_price` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `scalp_details` DROP COLUMN `target_price`;