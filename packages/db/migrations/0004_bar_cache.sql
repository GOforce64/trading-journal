CREATE TABLE `bar_days` (
	`symbol` text NOT NULL,
	`timeframe` text NOT NULL,
	`date` text NOT NULL,
	`count` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`symbol`, `timeframe`, `date`)
);
--> statement-breakpoint
CREATE TABLE `bars` (
	`symbol` text NOT NULL,
	`timeframe` text NOT NULL,
	`t` integer NOT NULL,
	`o` real NOT NULL,
	`h` real NOT NULL,
	`l` real NOT NULL,
	`c` real NOT NULL,
	`v` real NOT NULL,
	PRIMARY KEY(`symbol`, `timeframe`, `t`)
);
