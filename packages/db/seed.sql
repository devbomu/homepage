-- 로컬 개발용 초기 데이터. 운영 DB 에는 넣지 않는다.
-- 실행: pnpm db:seed:local

DELETE FROM comments;
DELETE FROM post_likes;
DELETE FROM post_tags;
DELETE FROM posts;
-- 카테고리는 자기참조 FK 가 ON DELETE RESTRICT 라 부모를 먼저 지울 수 없다.
-- (이건 의도된 제약이다 — 관리자에서도 자식 있는 카테고리는 삭제되지 않는다.)
-- 따라서 깊은 것부터 거꾸로 지운다. depth 는 0..5 로 제한돼 있다.
DELETE FROM categories WHERE depth = 5;
DELETE FROM categories WHERE depth = 4;
DELETE FROM categories WHERE depth = 3;
DELETE FROM categories WHERE depth = 2;
DELETE FROM categories WHERE depth = 1;
DELETE FROM categories WHERE depth = 0;
DELETE FROM tags;
DELETE FROM series;
DELETE FROM pages;
DELETE FROM projects;
DELETE FROM site_settings;

-- 사이트 설정
INSERT INTO site_settings (key, value) VALUES
  ('site.title',       '"namsu.kim"'),
  ('site.description', '"김남수의 개인 홈페이지"'),
  ('site.author',      '"김남수"'),
  ('site.locale',      '"ko"'),
  ('site.social',      '{"github":"https://github.com/devbomu"}');

-- 다중 뎁스 카테고리 예시
INSERT INTO categories (parent_id, slug, name, path, depth, sort_order) VALUES (NULL, 'dev', '개발', 'dev', 0, 1);
INSERT INTO categories (parent_id, slug, name, path, depth, sort_order)
  SELECT id, 'backend', '백엔드', path || '/backend', depth + 1, 1 FROM categories WHERE path = 'dev';
INSERT INTO categories (parent_id, slug, name, path, depth, sort_order)
  SELECT id, 'frontend', '프론트엔드', path || '/frontend', depth + 1, 2 FROM categories WHERE path = 'dev';
INSERT INTO categories (parent_id, slug, name, path, depth, sort_order)
  SELECT id, 'infra', '인프라', path || '/infra', depth + 1, 1 FROM categories WHERE path = 'dev/backend';
INSERT INTO categories (parent_id, slug, name, path, depth, sort_order) VALUES (NULL, 'life', '일상', 'life', 0, 2);

INSERT INTO tags (slug, name) VALUES
  ('cloudflare', 'Cloudflare'),
  ('astro', 'Astro'),
  ('hono', 'Hono'),
  ('sqlite', 'SQLite');

INSERT INTO posts (slug, title, summary, content, category_id, status, published_at, reading_minutes, word_count)
  SELECT
    'hello-world',
    '첫 글',
    '개인 홈페이지를 새로 만들면서 남기는 첫 글입니다.',
    '## 시작하며' || char(10) || char(10) || 'Astro, Hono, Cloudflare D1 로 개인 홈페이지를 다시 만들었습니다.' || char(10),
    id, 'published', unixepoch(), 1, 30
  FROM categories WHERE path = 'dev/backend/infra';

INSERT INTO post_tags (post_id, tag_id)
  SELECT p.id, t.id FROM posts p, tags t WHERE p.slug = 'hello-world' AND t.slug IN ('cloudflare', 'hono');

INSERT INTO pages (slug, title, content, status, published_at, show_in_nav, nav_label, sort_order) VALUES
  ('about', '소개', '안녕하세요. 김남수입니다.', 'published', unixepoch(), 1, '소개', 1);
