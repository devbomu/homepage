-- 검색 색인을 외부 콘텐츠(content='posts')에서 자체 저장 방식으로 바꾼다.
--
-- 증상: 글 본문을 50자 남짓 넘겨서 수정하면 UPDATE 가
--   "database disk image is malformed: SQLITE_CORRUPT_VTAB"
-- 로 실패했다. 새 글을 쓰는 것(INSERT)은 되고 고치는 것(UPDATE)만 안 됐다.
--
-- 원인: 외부 콘텐츠 FTS5 는 색인이 원본 테이블과 글자 단위로 일치한다는 것을
-- 전제로 한다. 지우는 것도 "지울 값을 다시 토큰화해서 빼는" 방식이라
-- (`INSERT INTO posts_fts(posts_fts, rowid, ...) VALUES('delete', ...)`),
-- 어긋나는 순간 SQLite 가 색인을 손상으로 판단한다.
--
-- 자체 저장 방식은 제목·요약·본문을 색인이 따로 들고 있으므로 rowid 로 그냥
-- 지우면 된다 — 맞춰야 할 불변식이 사라진다. 대가는 본문을 두 번 저장하는 것인데,
-- 개인 블로그 규모에서 그 저장 공간은 문제가 되지 않는다.
DROP TRIGGER posts_fts_after_insert;
--> statement-breakpoint
DROP TRIGGER posts_fts_after_delete;
--> statement-breakpoint
DROP TRIGGER posts_fts_after_update;
--> statement-breakpoint
DROP TABLE posts_fts;
--> statement-breakpoint
CREATE VIRTUAL TABLE posts_fts USING fts5(
  title,
  summary,
  content,
  tokenize='trigram'
);
--> statement-breakpoint
INSERT INTO posts_fts(rowid, title, summary, content)
  SELECT id, title, summary, content FROM posts WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE TRIGGER posts_fts_after_insert AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, summary, content)
  VALUES (new.id, new.title, new.summary, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER posts_fts_after_delete AFTER DELETE ON posts BEGIN
  DELETE FROM posts_fts WHERE rowid = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER posts_fts_after_update AFTER UPDATE ON posts BEGIN
  DELETE FROM posts_fts WHERE rowid = old.id;
  INSERT INTO posts_fts(rowid, title, summary, content)
  VALUES (new.id, new.title, new.summary, new.content);
END;
