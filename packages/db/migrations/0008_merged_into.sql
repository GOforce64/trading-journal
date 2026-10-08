DROP INDEX `tags_kind_name_idx`;--> statement-breakpoint
ALTER TABLE `tags` ADD `merged_into` text;--> statement-breakpoint
CREATE UNIQUE INDEX `tags_kind_name_idx` ON `tags` (`kind`,`name`) WHERE deleted_at is null;--> statement-breakpoint
ALTER TABLE `setups` ADD `merged_into` text;