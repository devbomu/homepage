-- 비밀 댓글.
--
-- 공개 화면에는 잠금 표시만 나가고 본문은 관리자만 본다.
-- 본문을 방문자별로 다르게 서버 렌더하면, 글 페이지가 엣지에 캐시되는 순간
-- 한 사람의 비밀 댓글이 다음 방문자에게 그대로 나간다. 그래서 아예 렌더하지 않는다.
ALTER TABLE comments ADD COLUMN is_secret INTEGER NOT NULL DEFAULT 0;

-- 모더레이션 큐에서 비밀 댓글만 추려 보기 위한 인덱스.
CREATE INDEX comments_secret_idx ON comments (is_secret, created_at DESC) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 카운터 트리거 재생성
--
-- 공개 댓글 수에서 비밀 댓글을 뺀다. 안 그러면 "댓글 5" 라고 써놓고
-- 실제로는 3개만 보이는 상태가 된다.
-- 이제 "공개적으로 보이는 댓글" = approved AND 미삭제 AND 비밀 아님.
-- ---------------------------------------------------------------------------
DROP TRIGGER comments_after_insert;
DROP TRIGGER comments_after_delete;
DROP TRIGGER comments_after_update_hidden;
DROP TRIGGER comments_after_update_visible;

CREATE TRIGGER comments_after_insert AFTER INSERT ON comments
WHEN new.status = 'approved' AND new.deleted_at IS NULL AND new.is_secret = 0
BEGIN
  UPDATE posts SET comment_count = comment_count + 1 WHERE id = new.post_id;
END;

CREATE TRIGGER comments_after_delete AFTER DELETE ON comments
WHEN old.status = 'approved' AND old.deleted_at IS NULL AND old.is_secret = 0
BEGIN
  UPDATE posts SET comment_count = max(comment_count - 1, 0) WHERE id = old.post_id;
END;

CREATE TRIGGER comments_after_update_hidden AFTER UPDATE ON comments
WHEN (old.status = 'approved' AND old.deleted_at IS NULL AND old.is_secret = 0)
 AND NOT (new.status = 'approved' AND new.deleted_at IS NULL AND new.is_secret = 0)
BEGIN
  UPDATE posts SET comment_count = max(comment_count - 1, 0) WHERE id = old.post_id;
END;

CREATE TRIGGER comments_after_update_visible AFTER UPDATE ON comments
WHEN NOT (old.status = 'approved' AND old.deleted_at IS NULL AND old.is_secret = 0)
 AND (new.status = 'approved' AND new.deleted_at IS NULL AND new.is_secret = 0)
BEGIN
  UPDATE posts SET comment_count = comment_count + 1 WHERE id = new.post_id;
END;
