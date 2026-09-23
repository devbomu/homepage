-- 공개 댓글 수에 비밀 댓글과 답글을 모두 포함시킨다.
--
-- 0002 에서는 "댓글 3개인데 2개만 보이면 숨긴 게 있다는 사실이 드러난다"는 이유로
-- 비밀 댓글을 뺐었다. 그런데 공개 화면은 비밀 댓글 자리에 잠금 표시를 그대로 그린다.
-- 존재는 이미 보이는데 숫자만 빼니 오히려 숫자와 화면이 어긋났다.
-- 이제 "승인되고 삭제되지 않은 댓글"이면 전부 센다 — 화면에 보이는 줄 수와 같다.
DROP TRIGGER comments_after_insert;
DROP TRIGGER comments_after_delete;
DROP TRIGGER comments_after_update_hidden;
DROP TRIGGER comments_after_update_visible;

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

-- 기존 글의 카운터를 실제 값으로 맞춘다.
-- 트리거만 바꾸면 이미 쌓여 있던 비밀 댓글이 영원히 빠진 채로 남는다.
UPDATE posts SET comment_count = (
  SELECT count(*) FROM comments
  WHERE comments.post_id = posts.id
    AND comments.status = 'approved'
    AND comments.deleted_at IS NULL
);
