-- drizzle-kit 이 표현하지 못하는 것들: FTS5 가상 테이블과 트리거.
-- 이 파일은 손으로 관리한다. schema.ts 를 고쳐도 여기는 자동 갱신되지 않는다.

-- ---------------------------------------------------------------------------
-- 전문 검색 (FTS5)
--
-- trigram 토크나이저를 쓴다. 한국어는 공백 기준 토큰화가 의미 없어서
-- unicode61 로는 "블로그"를 검색해도 "개발블로그"가 안 잡힌다.
-- trigram 은 3글자 단위로 쪼개 부분일치를 지원하므로 한국어에 맞다.
--
-- 대가: 2글자 이하 질의는 매칭되지 않는다.
-- 그런 질의는 쿼리 계층에서 LIKE 스캔으로 폴백한다 (글 수가 적어 충분히 싸다).
--
-- content='posts' 로 외부 콘텐츠 테이블을 쓴다 — 본문을 두 번 저장하지 않는다.
-- ---------------------------------------------------------------------------
CREATE VIRTUAL TABLE posts_fts USING fts5(
  title,
  summary,
  content,
  content='posts',
  content_rowid='id',
  tokenize='trigram'
);

-- 외부 콘텐츠 FTS 는 원본 테이블과 수동으로 동기화해야 한다.
CREATE TRIGGER posts_fts_after_insert AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, summary, content)
  VALUES (new.id, new.title, new.summary, new.content);
END;

CREATE TRIGGER posts_fts_after_delete AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, summary, content)
  VALUES ('delete', old.id, old.title, old.summary, old.content);
END;

CREATE TRIGGER posts_fts_after_update AFTER UPDATE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, summary, content)
  VALUES ('delete', old.id, old.title, old.summary, old.content);
  INSERT INTO posts_fts(rowid, title, summary, content)
  VALUES (new.id, new.title, new.summary, new.content);
END;

-- ---------------------------------------------------------------------------
-- 좋아요 카운터
-- 목록 페이지마다 읽히는 값이라 비정규화한다.
-- ---------------------------------------------------------------------------
CREATE TRIGGER post_likes_after_insert AFTER INSERT ON post_likes BEGIN
  UPDATE posts SET like_count = like_count + 1 WHERE id = new.post_id;
END;

CREATE TRIGGER post_likes_after_delete AFTER DELETE ON post_likes BEGIN
  UPDATE posts SET like_count = max(like_count - 1, 0) WHERE id = old.post_id;
END;

-- ---------------------------------------------------------------------------
-- 댓글 카운터
-- 공개 댓글 수 = status='approved' AND deleted_at IS NULL 인 것만.
-- 승인/스팸/삭제로 상태가 오갈 때도 정확히 따라가야 하므로
-- "보임 -> 안 보임", "안 보임 -> 보임" 전이를 각각 잡는다.
-- (댓글이 다른 글로 옮겨가는 경우는 없으므로 post_id 변경은 다루지 않는다.)
-- ---------------------------------------------------------------------------
CREATE TRIGGER comments_after_insert AFTER INSERT ON comments
WHEN new.status = 'approved' AND new.deleted_at IS NULL
BEGIN
  UPDATE posts SET comment_count = comment_count + 1 WHERE id = new.post_id;
END;

CREATE TRIGGER comments_after_delete AFTER DELETE ON comments
WHEN old.status = 'approved' AND old.deleted_at IS NULL
BEGIN
  UPDATE posts SET comment_count = max(comment_count - 1, 0) WHERE id = old.post_id;
END;

CREATE TRIGGER comments_after_update_hidden AFTER UPDATE ON comments
WHEN (old.status = 'approved' AND old.deleted_at IS NULL)
 AND NOT (new.status = 'approved' AND new.deleted_at IS NULL)
BEGIN
  UPDATE posts SET comment_count = max(comment_count - 1, 0) WHERE id = old.post_id;
END;

CREATE TRIGGER comments_after_update_visible AFTER UPDATE ON comments
WHEN NOT (old.status = 'approved' AND old.deleted_at IS NULL)
 AND (new.status = 'approved' AND new.deleted_at IS NULL)
BEGIN
  UPDATE posts SET comment_count = comment_count + 1 WHERE id = new.post_id;
END;

-- ---------------------------------------------------------------------------
-- updated_at 자동 갱신
--
-- WHEN 절로 "updated_at 을 명시적으로 바꾸지 않은 UPDATE" 에만 걸리게 한다.
-- 재귀 방지와, 호출자가 의도적으로 지정한 값을 덮어쓰지 않기 위함이다.
-- ---------------------------------------------------------------------------
CREATE TRIGGER categories_touch AFTER UPDATE ON categories
WHEN new.updated_at = old.updated_at
BEGIN
  UPDATE categories SET updated_at = unixepoch() WHERE id = new.id;
END;

CREATE TRIGGER tags_touch AFTER UPDATE ON tags
WHEN new.updated_at = old.updated_at
BEGIN
  UPDATE tags SET updated_at = unixepoch() WHERE id = new.id;
END;

CREATE TRIGGER series_touch AFTER UPDATE ON series
WHEN new.updated_at = old.updated_at
BEGIN
  UPDATE series SET updated_at = unixepoch() WHERE id = new.id;
END;

CREATE TRIGGER posts_touch AFTER UPDATE ON posts
WHEN new.updated_at = old.updated_at
BEGIN
  UPDATE posts SET updated_at = unixepoch() WHERE id = new.id;
END;

CREATE TRIGGER comments_touch AFTER UPDATE ON comments
WHEN new.updated_at = old.updated_at
BEGIN
  UPDATE comments SET updated_at = unixepoch() WHERE id = new.id;
END;

CREATE TRIGGER pages_touch AFTER UPDATE ON pages
WHEN new.updated_at = old.updated_at
BEGIN
  UPDATE pages SET updated_at = unixepoch() WHERE id = new.id;
END;

CREATE TRIGGER projects_touch AFTER UPDATE ON projects
WHEN new.updated_at = old.updated_at
BEGIN
  UPDATE projects SET updated_at = unixepoch() WHERE id = new.id;
END;

CREATE TRIGGER site_settings_touch AFTER UPDATE ON site_settings
WHEN new.updated_at = old.updated_at
BEGIN
  UPDATE site_settings SET updated_at = unixepoch() WHERE key = new.key;
END;
