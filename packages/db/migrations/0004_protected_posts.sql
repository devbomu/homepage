-- 비밀글.
--
-- password_hash 가 있으면 본문은 비밀번호를 넣어야 열린다.
-- 평문은 어디에도 저장하지 않는다 (PBKDF2-SHA256 해시만 들어간다).
-- protected_listing 은 이 글이 목록에 어떻게 보이는지를 정한다
-- (title / masked / hidden). 값 검증은 API 의 zod 가 한다 —
-- CHECK 제약을 새로 걸면 SQLite 가 posts 테이블을 통째로 다시 만들고,
-- 그 과정에서 posts 에 걸린 FTS 동기화 트리거까지 같이 날아간다.
ALTER TABLE `posts` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `protected_listing` text DEFAULT 'title' NOT NULL;--> statement-breakpoint
CREATE INDEX `posts_protected_idx` ON `posts` (`protected_listing`) WHERE password_hash is not null and deleted_at is null;
