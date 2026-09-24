-- 로컬 개발용 초기 데이터. 운영 DB 에는 넣지 않는다.
-- 실행: pnpm db:seed:local

DELETE FROM comments;
DELETE FROM guestbook;
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

-- LIKE 와일드카드가 든 slug.
-- slugify 는 '_' 를 '-' 로 바꾸므로 관리자 API 로는 이런 slug 가 안 생기지만,
-- DB 제약은 허용한다. 하위 트리 조회가 ESCAPE 절 없이 깨지던 적이 있어
-- 회귀 검증용으로 남겨둔다.
INSERT INTO categories (parent_id, slug, name, path, depth, sort_order) VALUES (NULL, 'a_b', '언더바 상위', 'a_b', 0, 9);
INSERT INTO categories (parent_id, slug, name, path, depth, sort_order)
  SELECT id, 'kid', '언더바 하위', path || '/kid', depth + 1, 1 FROM categories WHERE path = 'a_b';

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

-- 예약 발행 검증용.
-- 공개 조건이 status 와 published_at 을 함께 보는지 확인한다.
-- 예전에는 status 만 봐서, 예약은 영영 안 나오고 미래 발행은 즉시 나왔다.
INSERT INTO posts (slug, title, summary, content, status, published_at, reading_minutes, word_count) VALUES
  ('예약-지난것',  '예약이지만 시간이 지난 글', '보여야 한다',   '본문', 'scheduled', unixepoch() - 3600,  1, 10),
  ('예약-미래것',  '예약이고 아직 시간 전인 글', '숨어야 한다',   '본문', 'scheduled', unixepoch() + 86400, 1, 10),
  ('발행-미래것',  '발행이지만 시간이 미래인 글', '숨어야 한다',   '본문', 'published', unixepoch() + 86400, 1, 10);

INSERT INTO post_tags (post_id, tag_id)
  SELECT p.id, t.id FROM posts p, tags t WHERE p.slug = 'hello-world' AND t.slug IN ('cloudflare', 'hono');

INSERT INTO pages (slug, title, content, status, published_at, show_in_nav, nav_label, sort_order) VALUES
  ('about', '소개', '안녕하세요. 김남수입니다.', 'published', unixepoch(), 1, '소개', 1);
