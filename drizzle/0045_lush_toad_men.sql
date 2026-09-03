CREATE TABLE `trendbrief_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`action_type` text NOT NULL,
	`status` text NOT NULL,
	`actor` text NOT NULL,
	`notes` text,
	`accepted_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opportunity_id`) REFERENCES `trendbrief_opportunities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trendbrief_actions_opportunity_idx` ON `trendbrief_actions` (`opportunity_id`);--> statement-breakpoint
CREATE INDEX `trendbrief_actions_project_idx` ON `trendbrief_actions` (`project_id`);--> statement-breakpoint
CREATE TABLE `trendbrief_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`evidence_type` text NOT NULL,
	`subject_url` text NOT NULL,
	`subject_query` text,
	`observation_start` text NOT NULL,
	`observation_end` text NOT NULL,
	`data_state` text NOT NULL,
	`metrics` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`captured_at` text DEFAULT (current_timestamp) NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trendbrief_evidence_dedupe_idx` ON `trendbrief_evidence` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `trendbrief_evidence_project_idx` ON `trendbrief_evidence` (`project_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `trendbrief_evidence_organization_idx` ON `trendbrief_evidence` (`organization_id`);--> statement-breakpoint
CREATE TABLE `trendbrief_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`detector_id` text NOT NULL,
	`detector_version` text NOT NULL,
	`type` text NOT NULL,
	`subject_url` text NOT NULL,
	`subject_query` text NOT NULL,
	`status` text DEFAULT 'detected' NOT NULL,
	`impact_score` real NOT NULL,
	`effort_score` real NOT NULL,
	`confidence_score` real NOT NULL,
	`priority_score` real NOT NULL,
	`rationale_codes` text NOT NULL,
	`relevance_status` text NOT NULL,
	`first_detected_at` text NOT NULL,
	`last_detected_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trendbrief_opportunities_dedupe_idx` ON `trendbrief_opportunities` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `trendbrief_opportunities_project_status_idx` ON `trendbrief_opportunities` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `trendbrief_opportunities_organization_idx` ON `trendbrief_opportunities` (`organization_id`);--> statement-breakpoint
CREATE TABLE `trendbrief_opportunity_evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`opportunity_id` text NOT NULL,
	`evidence_id` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `trendbrief_opportunities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evidence_id`) REFERENCES `trendbrief_evidence`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trendbrief_opportunity_evidence_unique_idx` ON `trendbrief_opportunity_evidence` (`opportunity_id`,`evidence_id`);--> statement-breakpoint
CREATE INDEX `trendbrief_opportunity_evidence_evidence_idx` ON `trendbrief_opportunity_evidence` (`evidence_id`);--> statement-breakpoint
CREATE TABLE `trendbrief_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`baseline_window_start` text NOT NULL,
	`baseline_window_end` text NOT NULL,
	`comparison_window_start` text NOT NULL,
	`comparison_window_end` text NOT NULL,
	`measured_metrics` text NOT NULL,
	`classification` text NOT NULL,
	`confidence_score` real NOT NULL,
	`attribution_note` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `trendbrief_opportunities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trendbrief_outcomes_opportunity_comparison_idx` ON `trendbrief_outcomes` (`opportunity_id`,`comparison_window_end`);--> statement-breakpoint
CREATE INDEX `trendbrief_outcomes_project_idx` ON `trendbrief_outcomes` (`project_id`);--> statement-breakpoint
CREATE TABLE `trendbrief_recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`recommendation_type` text NOT NULL,
	`generation_method` text NOT NULL,
	`proposed_action` text NOT NULL,
	`grounded_summary` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `trendbrief_opportunities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trendbrief_recommendations_opportunity_idx` ON `trendbrief_recommendations` (`opportunity_id`);--> statement-breakpoint
CREATE INDEX `trendbrief_recommendations_project_idx` ON `trendbrief_recommendations` (`project_id`);