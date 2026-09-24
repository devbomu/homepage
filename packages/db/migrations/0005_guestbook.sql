-- 방명록.
--
-- 댓글과 닮았지만 글에 붙지 않고 답글도 없다. 기본 상태가 'approved' 인 것도
-- 댓글과 같다 — 승인 절차 없이 바로 공개되고 문제가 되는 것만 사후에 내린다.
CREATE TABLE `guestbook` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`author_name` text NOT NULL,
	`author_email` text,
	`author_website` text,
	`body` text NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`visitor_hash` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "guestbook_author_ck" CHECK(length("guestbook"."author_name") between 1 and 50),
	CONSTRAINT "guestbook_body_ck" CHECK(length("guestbook"."body") between 1 and 2000)
);
--> statement-breakpoint
CREATE INDEX `guestbook_public_idx` ON `guestbook` (`created_at`) WHERE status = 'approved' and deleted_at is null;--> statement-breakpoint
CREATE INDEX `guestbook_moderation_idx` ON `guestbook` (`status`,`created_at`) WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX `guestbook_visitor_recent_idx` ON `guestbook` (`visitor_hash`,`created_at`);
--> statement-breakpoint
-- updated_at 을 손으로 챙기지 않도록 트리거에 맡긴다 (comments 와 같은 방식).
CREATE TRIGGER guestbook_touch AFTER UPDATE ON guestbook
WHEN new.updated_at = old.updated_at
BEGIN
  UPDATE guestbook SET updated_at = unixepoch() WHERE id = new.id;
END;
