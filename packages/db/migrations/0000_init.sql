CREATE TABLE `admin_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`detail` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_audit_recent_idx` ON `admin_audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `admin_audit_entity_idx` ON `admin_audit_log` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`path` text NOT NULL,
	`depth` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "categories_slug_ck" CHECK(length("categories"."slug") between 1 and 200
      and "categories"."slug" = lower("categories"."slug")
      and "categories"."slug" not glob '*[ /?#&=%+]*'),
	CONSTRAINT "categories_name_ck" CHECK(length("categories"."name") between 1 and 100),
	CONSTRAINT "categories_depth_ck" CHECK("categories"."depth" between 0 and 5),
	CONSTRAINT "categories_not_own_parent_ck" CHECK("categories"."parent_id" is null or "categories"."parent_id" <> "categories"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_path_uq` ON `categories` (`path`);--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`,`sort_order`,`id`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`parent_id` integer,
	`author_name` text NOT NULL,
	`author_email` text,
	`author_website` text,
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`is_owner` integer DEFAULT false NOT NULL,
	`visitor_hash` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "comments_body_ck" CHECK(length(trim("comments"."body")) between 1 and 5000),
	CONSTRAINT "comments_author_ck" CHECK(length("comments"."author_name") between 1 and 50),
	CONSTRAINT "comments_status_ck" CHECK("comments"."status" in ('pending','approved','spam','deleted')),
	CONSTRAINT "comments_not_own_parent_ck" CHECK("comments"."parent_id" is null or "comments"."parent_id" <> "comments"."id"),
	CONSTRAINT "comments_email_ck" CHECK("comments"."author_email" is null or "comments"."author_email" glob '*?@?*.?*')
);
--> statement-breakpoint
CREATE INDEX `comments_post_approved_idx` ON `comments` (`post_id`,`created_at`) WHERE status = 'approved' and deleted_at is null;--> statement-breakpoint
CREATE INDEX `comments_parent_idx` ON `comments` (`parent_id`) WHERE parent_id is not null;--> statement-breakpoint
CREATE INDEX `comments_moderation_idx` ON `comments` (`status`,`created_at`) WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX `comments_visitor_recent_idx` ON `comments` (`visitor_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`object_key` text NOT NULL,
	`url` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`alt` text,
	`uploaded_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "media_size_ck" CHECK("media"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_object_key_uq` ON `media` (`object_key`);--> statement-breakpoint
CREATE INDEX `media_created_idx` ON `media` (`created_at`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`content_html` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`show_in_nav` integer DEFAULT false NOT NULL,
	`nav_label` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`meta_description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "pages_slug_ck" CHECK(length("pages"."slug") between 1 and 200
      and "pages"."slug" = lower("pages"."slug")
      and "pages"."slug" not glob '*[ /?#&=%+]*'),
	CONSTRAINT "pages_status_ck" CHECK("pages"."status" in ('draft','scheduled','published','archived')),
	CONSTRAINT "pages_schedule_ck" CHECK("pages"."status" not in ('published','scheduled') or "pages"."published_at" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_slug_uq` ON `pages` (`slug`);--> statement-breakpoint
CREATE INDEX `pages_nav_idx` ON `pages` (`sort_order`,`id`) WHERE show_in_nav = 1 and status = 'published';--> statement-breakpoint
CREATE TABLE `post_likes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`visitor_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "post_likes_hash_ck" CHECK(length("post_likes"."visitor_hash") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_likes_uq` ON `post_likes` (`post_id`,`visitor_hash`);--> statement-breakpoint
CREATE TABLE `post_tags` (
	`post_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`post_id`, `tag_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_tags_tag_idx` ON `post_tags` (`tag_id`,`post_id`);--> statement-breakpoint
CREATE TABLE `post_view_daily` (
	`post_id` integer NOT NULL,
	`day` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`post_id`, `day`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_view_daily_day_idx` ON `post_view_daily` (`day`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`content` text DEFAULT '' NOT NULL,
	`content_html` text,
	`cover_image_url` text,
	`category_id` integer,
	`series_id` integer,
	`series_order` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`reading_minutes` integer DEFAULT 0 NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`like_count` integer DEFAULT 0 NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`allow_comments` integer DEFAULT true NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`meta_title` text,
	`meta_description` text,
	`og_image_url` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "posts_slug_ck" CHECK(length("posts"."slug") between 1 and 200
      and "posts"."slug" = lower("posts"."slug")
      and "posts"."slug" not glob '*[ /?#&=%+]*'),
	CONSTRAINT "posts_title_ck" CHECK(length("posts"."title") between 1 and 200),
	CONSTRAINT "posts_summary_ck" CHECK("posts"."summary" is null or length("posts"."summary") <= 500),
	CONSTRAINT "posts_status_ck" CHECK("posts"."status" in ('draft','scheduled','published','archived')),
	CONSTRAINT "posts_schedule_ck" CHECK("posts"."status" not in ('published','scheduled') or "posts"."published_at" is not null),
	CONSTRAINT "posts_series_order_ck" CHECK("posts"."series_id" is not null or "posts"."series_order" is null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_slug_uq` ON `posts` (`slug`);--> statement-breakpoint
CREATE INDEX `posts_published_idx` ON `posts` (`published_at`,`id`) WHERE status = 'published' and deleted_at is null;--> statement-breakpoint
CREATE INDEX `posts_category_idx` ON `posts` (`category_id`,`published_at`) WHERE status = 'published' and deleted_at is null;--> statement-breakpoint
CREATE INDEX `posts_admin_idx` ON `posts` (`status`,`updated_at`) WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX `posts_series_order_uq` ON `posts` (`series_id`,`series_order`) WHERE series_id is not null and series_order is not null and deleted_at is null;--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`description` text DEFAULT '' NOT NULL,
	`description_html` text,
	`thumbnail_url` text,
	`repo_url` text,
	`demo_url` text,
	`tech_stack` text DEFAULT '[]' NOT NULL,
	`role` text,
	`started_on` text,
	`ended_on` text,
	`is_featured` integer DEFAULT false NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "projects_slug_ck" CHECK(length("projects"."slug") between 1 and 200
      and "projects"."slug" = lower("projects"."slug")
      and "projects"."slug" not glob '*[ /?#&=%+]*'),
	CONSTRAINT "projects_period_ck" CHECK("projects"."ended_on" is null or "projects"."started_on" is null or "projects"."ended_on" >= "projects"."started_on")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_uq` ON `projects` (`slug`);--> statement-breakpoint
CREATE INDEX `projects_public_idx` ON `projects` (`is_featured`,`sort_order`,`started_on`) WHERE is_published = 1;--> statement-breakpoint
CREATE TABLE `series` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`cover_image_url` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "series_slug_ck" CHECK(length("series"."slug") between 1 and 200
      and "series"."slug" = lower("series"."slug")
      and "series"."slug" not glob '*[ /?#&=%+]*'),
	CONSTRAINT "series_title_ck" CHECK(length("series"."title") between 1 and 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_slug_uq` ON `series` (`slug`);--> statement-breakpoint
CREATE TABLE `site_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "tags_slug_ck" CHECK(length("tags"."slug") between 1 and 200
      and "tags"."slug" = lower("tags"."slug")
      and "tags"."slug" not glob '*[ /?#&=%+]*'),
	CONSTRAINT "tags_name_ck" CHECK(length("tags"."name") between 1 and 50)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_slug_uq` ON `tags` (`slug`);