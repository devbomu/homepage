/**
 * D1(SQLite) 스키마 — 이 파일이 테이블 구조의 단일 진실 공급원이다.
 *
 * 마이그레이션은 `pnpm db:generate` 로 이 파일에서 생성한다.
 * 다만 drizzle-kit 이 표현하지 못하는 것들(FTS5 가상 테이블, 트리거)은
 * migrations/ 아래에 손으로 쓴 SQL 파일로 따로 관리한다.
 *
 * 시각은 전부 unix epoch 초로 저장한다 (SQLite 에 native timestamp 타입이 없다).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

/** 생성/수정 시각 — 모든 테이블 공통. */
const timestamps = {
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at')
    .notNull()
    .default(sql`(unixepoch())`),
};

export const POST_STATUSES = ['draft', 'scheduled', 'published', 'archived'] as const;
export const COMMENT_STATUSES = ['pending', 'approved', 'spam', 'deleted'] as const;

export type PostStatus = (typeof POST_STATUSES)[number];
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

/**
 * slug 규칙: 소문자 / 공백 없음 / URL 예약문자 없음. 한글 slug 도 허용한다.
 * SQLite 에는 도메인 타입이 없으므로 테이블마다 CHECK 로 반복 적용한다.
 */
const slugCheck = (column: AnySQLiteColumn) =>
  sql`length(${column}) between 1 and 200
      and ${column} = lower(${column})
      and ${column} not glob '*[ /?#&=%+]*'`;

// ---------------------------------------------------------------------------
// 분류 체계
// ---------------------------------------------------------------------------

/**
 * 다중 뎁스 카테고리.
 *
 * parentId 로 트리를 표현하고, path 에 조상 slug 를 '/' 로 이어 머티리얼라이즈한다.
 *   예) 개발 > 백엔드 > Go  ->  path = 'dev/backend/go', depth = 2
 *
 * 하위 트리 전체 조회는 `path = ? OR path LIKE ? || '/%'` 한 방으로 끝난다.
 * 재귀 CTE 없이 인덱스를 타므로 D1 의 row-read 과금에도 유리하다.
 *
 * path 에 UNIQUE 가 걸려 있어 형제간 slug 중복은 자동으로 막힌다
 * (SQLite 의 UNIQUE 는 NULL 을 서로 다른 값으로 보므로,
 *  루트끼리의 중복은 (parentId, slug) UNIQUE 로는 막히지 않는다).
 */
export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    parentId: integer('parent_id').references((): AnySQLiteColumn => categories.id, {
      onDelete: 'restrict',
    }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    path: text('path').notNull(),
    depth: integer('depth').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('categories_path_uq').on(t.path),
    index('categories_parent_idx').on(t.parentId, t.sortOrder, t.id),
    check('categories_slug_ck', slugCheck(t.slug)),
    check('categories_name_ck', sql`length(${t.name}) between 1 and 100`),
    check('categories_depth_ck', sql`${t.depth} between 0 and 5`),
    check('categories_not_own_parent_ck', sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  ],
);

export const tags = sqliteTable(
  'tags',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('tags_slug_uq').on(t.slug),
    check('tags_slug_ck', slugCheck(t.slug)),
    check('tags_name_ck', sql`length(${t.name}) between 1 and 50`),
  ],
);

/** 연재 묶음. 여러 글을 순서대로 엮는다. */
export const series = sqliteTable(
  'series',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    coverImageUrl: text('cover_image_url'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('series_slug_uq').on(t.slug),
    check('series_slug_ck', slugCheck(t.slug)),
    check('series_title_ck', sql`length(${t.title}) between 1 and 200`),
  ],
);

// ---------------------------------------------------------------------------
// 글
// ---------------------------------------------------------------------------

export const posts = sqliteTable(
  'posts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),

    // 마크다운 원문이 정본. HTML 은 발행 시점에 한 번만 렌더해 캐시한다
    // (요청마다 파싱하면 Workers CPU 시간을 그냥 태우는 셈이다).
    content: text('content').notNull().default(''),
    contentHtml: text('content_html'),

    coverImageUrl: text('cover_image_url'),
    categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
    seriesId: integer('series_id').references(() => series.id, { onDelete: 'set null' }),
    seriesOrder: integer('series_order'),

    status: text('status', { enum: POST_STATUSES }).notNull().default('draft'),
    publishedAt: integer('published_at'),

    readingMinutes: integer('reading_minutes').notNull().default(0),
    wordCount: integer('word_count').notNull().default(0),
    viewCount: integer('view_count').notNull().default(0),
    likeCount: integer('like_count').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),

    allowComments: integer('allow_comments', { mode: 'boolean' }).notNull().default(true),
    isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),

    metaTitle: text('meta_title'),
    metaDescription: text('meta_description'),
    ogImageUrl: text('og_image_url'),

    ...timestamps,
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    uniqueIndex('posts_slug_uq').on(t.slug),

    // 공개 목록의 주 경로. 부분 인덱스로 초안/삭제 글을 인덱스에서 아예 제외한다.
    index('posts_published_idx')
      .on(t.publishedAt, t.id)
      .where(sql`status = 'published' and deleted_at is null`),
    index('posts_category_idx')
      .on(t.categoryId, t.publishedAt)
      .where(sql`status = 'published' and deleted_at is null`),
    index('posts_admin_idx')
      .on(t.status, t.updatedAt)
      .where(sql`deleted_at is null`),
    uniqueIndex('posts_series_order_uq')
      .on(t.seriesId, t.seriesOrder)
      .where(sql`series_id is not null and series_order is not null and deleted_at is null`),

    check('posts_slug_ck', slugCheck(t.slug)),
    check('posts_title_ck', sql`length(${t.title}) between 1 and 200`),
    check('posts_summary_ck', sql`${t.summary} is null or length(${t.summary}) <= 500`),
    check('posts_status_ck', sql`${t.status} in ('draft','scheduled','published','archived')`),
    // 발행/예약 상태는 시각이 반드시 있어야 한다.
    check(
      'posts_schedule_ck',
      sql`${t.status} not in ('published','scheduled') or ${t.publishedAt} is not null`,
    ),
    check('posts_series_order_ck', sql`${t.seriesId} is not null or ${t.seriesOrder} is null`),
  ],
);

export const postTags = sqliteTable(
  'post_tags',
  {
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.tagId] }),
    index('post_tags_tag_idx').on(t.tagId, t.postId),
  ],
);

// ---------------------------------------------------------------------------
// 반응 (좋아요 / 댓글 / 조회)
// ---------------------------------------------------------------------------

/**
 * 좋아요.
 *
 * 방문자 식별은 sha256(ip + user-agent + 서버 시크릿 솔트) 해시만 저장한다.
 * 원본 IP 는 어디에도 기록하지 않는다 — 공개 저장소이고, 좋아요 중복만
 * 막으면 되는데 IP 원문까지 들고 있을 이유가 없다.
 */
export const postLikes = sqliteTable(
  'post_likes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    visitorHash: text('visitor_hash').notNull(),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex('post_likes_uq').on(t.postId, t.visitorHash),
    check('post_likes_hash_ck', sql`length(${t.visitorHash}) = 64`),
  ],
);

export const comments = sqliteTable(
  'comments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    parentId: integer('parent_id').references((): AnySQLiteColumn => comments.id, {
      onDelete: 'cascade',
    }),

    authorName: text('author_name').notNull(),
    // authorEmail 은 답글 알림과 아바타 해시 용도로만 쓴다.
    // 공개 API 응답에는 절대 싣지 않는다 (쿼리 계층에서 아예 SELECT 하지 않는다).
    authorEmail: text('author_email'),
    authorWebsite: text('author_website'),

    body: text('body').notNull(),
    status: text('status', { enum: COMMENT_STATUSES }).notNull().default('pending'),
    isOwner: integer('is_owner', { mode: 'boolean' }).notNull().default(false),

    /**
     * 비밀 댓글. 공개 화면에는 잠금 표시만 나가고 본문은 관리자만 본다.
     * 비밀 댓글의 답글은 서버가 강제로 비밀로 만든다 — 답글이 원문 맥락을 흘리기 때문이다.
     */
    isSecret: integer('is_secret', { mode: 'boolean' }).notNull().default(false),

    visitorHash: text('visitor_hash'),
    userAgent: text('user_agent'),

    ...timestamps,
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    index('comments_post_approved_idx')
      .on(t.postId, t.createdAt)
      .where(sql`status = 'approved' and deleted_at is null`),
    index('comments_parent_idx')
      .on(t.parentId)
      .where(sql`parent_id is not null`),
    // 관리자 모더레이션 큐
    index('comments_moderation_idx')
      .on(t.status, t.createdAt)
      .where(sql`deleted_at is null`),
    // 같은 방문자의 연속 도배를 잡기 위한 레이트리밋 조회
    index('comments_visitor_recent_idx').on(t.visitorHash, t.createdAt),

    check('comments_body_ck', sql`length(trim(${t.body})) between 1 and 5000`),
    check('comments_author_ck', sql`length(${t.authorName}) between 1 and 50`),
    check('comments_status_ck', sql`${t.status} in ('pending','approved','spam','deleted')`),
    check('comments_not_own_parent_ck', sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
    check('comments_email_ck', sql`${t.authorEmail} is null or ${t.authorEmail} glob '*?@?*.?*'`),
  ],
);

/** 일별 조회수 롤업. posts.viewCount 는 누적 합계. */
export const postViewDaily = sqliteTable(
  'post_view_daily',
  {
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    day: text('day').notNull(), // 'YYYY-MM-DD'
    views: integer('views').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.postId, t.day] }), index('post_view_daily_day_idx').on(t.day)],
);

// ---------------------------------------------------------------------------
// 블로그 외 사이트 콘텐츠
// ---------------------------------------------------------------------------

/** 글이 아닌 단독 페이지 (/about, /now, /uses, /resume ...) */
export const pages = sqliteTable(
  'pages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    contentHtml: text('content_html'),
    status: text('status', { enum: POST_STATUSES }).notNull().default('draft'),
    publishedAt: integer('published_at'),
    showInNav: integer('show_in_nav', { mode: 'boolean' }).notNull().default(false),
    navLabel: text('nav_label'),
    sortOrder: integer('sort_order').notNull().default(0),
    metaDescription: text('meta_description'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pages_slug_uq').on(t.slug),
    index('pages_nav_idx')
      .on(t.sortOrder, t.id)
      .where(sql`show_in_nav = 1 and status = 'published'`),
    check('pages_slug_ck', slugCheck(t.slug)),
    check('pages_status_ck', sql`${t.status} in ('draft','scheduled','published','archived')`),
    check(
      'pages_schedule_ck',
      sql`${t.status} not in ('published','scheduled') or ${t.publishedAt} is not null`,
    ),
  ],
);

/** 포트폴리오 / 프로젝트 */
export const projects = sqliteTable(
  'projects',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    description: text('description').notNull().default(''),
    descriptionHtml: text('description_html'),
    thumbnailUrl: text('thumbnail_url'),
    repoUrl: text('repo_url'),
    demoUrl: text('demo_url'),
    // SQLite 에 배열 타입이 없으므로 JSON 문자열로 둔다.
    techStack: text('tech_stack', { mode: 'json' }).$type<string[]>().notNull().default([]),
    role: text('role'),
    startedOn: text('started_on'), // 'YYYY-MM-DD'
    endedOn: text('ended_on'),
    isFeatured: integer('is_featured', { mode: 'boolean' }).notNull().default(false),
    isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('projects_slug_uq').on(t.slug),
    index('projects_public_idx')
      .on(t.isFeatured, t.sortOrder, t.startedOn)
      .where(sql`is_published = 1`),
    check('projects_slug_ck', slugCheck(t.slug)),
    check(
      'projects_period_ck',
      sql`${t.endedOn} is null or ${t.startedOn} is null or ${t.endedOn} >= ${t.startedOn}`,
    ),
  ],
);

/** R2 에 올린 이미지/첨부의 메타데이터. 파일 실체는 R2 에 있다. */
export const media = sqliteTable(
  'media',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    objectKey: text('object_key').notNull(),
    url: text('url').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    alt: text('alt'),
    uploadedBy: text('uploaded_by'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex('media_object_key_uq').on(t.objectKey),
    index('media_created_idx').on(t.createdAt),
    check('media_size_ck', sql`${t.sizeBytes} >= 0`),
  ],
);

/** 사이트 설정(제목, 소개, 소셜 링크 등). 관리자에서 편집한다. */
export const siteSettings = sqliteTable('site_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at')
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * 관리자 행위 감사 로그.
 * actor 에는 Cloudflare Access JWT 에서 검증된 값만 들어간다.
 */
export const adminAuditLog = sqliteTable(
  'admin_audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index('admin_audit_recent_idx').on(t.createdAt),
    index('admin_audit_entity_idx').on(t.entityType, t.entityId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// 추론 타입
// ---------------------------------------------------------------------------

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type Series = typeof series.$inferSelect;
export type NewSeries = typeof series.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
