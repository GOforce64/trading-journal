CREATE TABLE `missed_details` (
	`trade_id` text PRIMARY KEY NOT NULL,
	`direction` text NOT NULL,
	`entry_price` real NOT NULL,
	`stop_price` real,
	`target_price` real,
	`exit_price` real,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action
);
