import { categories, posts, postTags, series, tags, type Db, type PostStatus } from '@namsu/db';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { renderMarkdown } from '../lib/markdown';
import { type Cursor, slicePage } from '../lib/pagination';

export interface PostTag {
  slug: string;
  name: string;
}

export interface PostSummary {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  coverImageUrl: string | null;
  publishedAt: number | null;
  readingMinutes: number;
  wordCount: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  isPinned: boolean;
  category: { slug: string; name: string; path: string } | null;
  series: { slug: string; title: string; order: number | null } | null;
  tags: PostTag[];
}

export interface PostDetail extends PostSummary {
  contentHtml: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  allowComments: boolean;
  updatedAt: number;
}

/** 목록/상세가 공유하는 select 목록. */
const summaryColumns = {
  id: posts.id,
  slug: posts.slug,
  title: posts.title,
  summary: posts.summary,
  coverImageUrl: posts.coverImageUrl,
  publishedAt: posts.publishedAt,
  readingMinutes: posts.readingMinutes,
  wordCount: posts.wordCount,
  viewCount: posts.viewCount,
  likeCount: posts.likeCount,
  commentCount: posts.commentCount,
  isPinned: posts.isPinned,
  seriesOrder: posts.seriesOrder,
  categorySlug: categories.slug,
  categoryName: categories.name,
  categoryPath: categories.path,
  seriesSlug: series.slug,
  seriesTitle: series.title,
} as const;

/**
 * summaryColumns 를 select 한 결과의 형태.
 *
 * Drizzle 은 left join 으로 붙은 컬럼을 자동으로 nullable 로 만들지 않는다
 * (조인 대상 컬럼 자체의 NOT NULL 여부를 따른다). 카테고리나 시리즈가 없는 글에서는
 * 실제로 null 이 오므로 여기서 명시적으로 nullable 로 선언해 둔다.
 */
interface SummaryRow {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  coverImageUrl: string | null;
  publishedAt: number | null;
  readingMinutes: number;
  wordCount: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  isPinned: boolean;
  seriesOrder: number | null;
  categorySlug: string | null;
  categoryName: string | null;
  categoryPath: string | null;
  seriesSlug: string | null;
  seriesTitle: string | null;
}

function toSummary(row: SummaryRow, tagsByPost: Map<number, PostTag[]>): PostSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    coverImageUrl: row.coverImageUrl,
    publishedAt: row.publishedAt,
    readingMinutes: row.readingMinutes,
    wordCount: row.wordCount,
    viewCount: row.viewCount,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    isPinned: row.isPinned,
    category: row.categorySlug
      ? { slug: row.categorySlug, name: row.categoryName!, path: row.categoryPath! }
      : null,
    series: row.seriesSlug
      ? { slug: row.seriesSlug, title: row.seriesTitle!, order: row.seriesOrder }
      : null,
    tags: tagsByPost.get(row.id) ?? [],
  };
}

/**
 * 여러 글의 태그를 한 번에 읽는다.
 *
 * 글마다 태그를 조회하면 목록 한 페이지에 쿼리가 20번 더 나간다 (N+1).
 * D1 은 왕복 비용이 크고 읽은 row 수로 과금하므로 반드시 묶어서 읽는다.
 */
async function loadTags(db: Db, postIds: number[]): Promise<Map<number, PostTag[]>> {
  const byPost = new Map<number, PostTag[]>();
  if (postIds.length === 0) return byPost;

  const rows = await db
    .select({ postId: postTags.postId, slug: tags.slug, name: tags.name })
    .from(postTags)
    .innerJoin(tags, eq(tags.id, postTags.tagId))
    .where(inArray(postTags.postId, postIds));

  for (const row of rows) {
    const list = byPost.get(row.postId);
    if (list) list.push({ slug: row.slug, name: row.name });
    else byPost.set(row.postId, [{ slug: row.slug, name: row.name }]);
  }
  return byPost;
}

/** 공개 글만 보이도록 하는 조건. 모든 공개 쿼리가 이걸 통과해야 한다. */
const publishedOnly = and(eq(posts.status, 'published'), isNull(posts.deletedAt));

export interface ListOptions {
  limit: number;
  cursor: Cursor | null;
  categoryIds?: number[];
  tagId?: number;
  seriesId?: number;
}

/**
 * 공개 글 목록.
 *
 * 정렬은 (published_at DESC, id DESC) 이고 커서도 같은 키를 쓴다.
 * OFFSET 을 쓰지 않는 이유는 pagination.ts 주석 참고.
 */
export async function listPublishedPosts(db: Db, opts: ListOptions) {
  const filters = [publishedOnly];

  if (opts.categoryIds?.length) filters.push(inArray(posts.categoryId, opts.categoryIds));
  if (opts.seriesId != null) filters.push(eq(posts.seriesId, opts.seriesId));

  if (opts.cursor) {
    const { sortValue, id } = opts.cursor;
    filters.push(
      or(
        sql`${posts.publishedAt} < ${sortValue}`,
        and(sql`${posts.publishedAt} = ${sortValue}`, sql`${posts.id} < ${id}`),
      )!,
    );
  }

  if (opts.tagId != null) {
    filters.push(
      sql`exists (select 1 from ${postTags} where ${postTags.postId} = ${posts.id} and ${postTags.tagId} = ${opts.tagId})`,
    );
  }

  const rows = await db
    .select(summaryColumns)
    .from(posts)
    .leftJoin(categories, eq(categories.id, posts.categoryId))
    .leftJoin(series, eq(series.id, posts.seriesId))
    .where(and(...filters))
    .orderBy(desc(posts.publishedAt), desc(posts.id))
    // 다음 페이지 존재 여부 판단용으로 하나 더 읽는다 (COUNT 쿼리를 아낀다).
    .limit(opts.limit + 1);

  const page = slicePage(rows, opts.limit, (row) => ({
    sortValue: row.publishedAt ?? 0,
    id: row.id,
  }));

  const tagsByPost = await loadTags(
    db,
    page.items.map((r) => r.id),
  );

  return {
    items: page.items.map((row) => toSummary(row, tagsByPost)),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

/** 첫 페이지 상단에 따로 보여줄 고정 글. */
export async function listPinnedPosts(db: Db, limit = 3): Promise<PostSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(posts)
    .leftJoin(categories, eq(categories.id, posts.categoryId))
    .leftJoin(series, eq(series.id, posts.seriesId))
    .where(and(publishedOnly, eq(posts.isPinned, true)))
    .orderBy(desc(posts.publishedAt))
    .limit(limit);

  const tagsByPost = await loadTags(db, rows.map((r) => r.id));
  return rows.map((row) => toSummary(row, tagsByPost));
}

export async function getPublishedPostBySlug(db: Db, slug: string): Promise<PostDetail | null> {
  const [row] = await db
    .select({
      ...summaryColumns,
      contentHtml: posts.contentHtml,
      content: posts.content,
      metaTitle: posts.metaTitle,
      metaDescription: posts.metaDescription,
      ogImageUrl: posts.ogImageUrl,
      allowComments: posts.allowComments,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .leftJoin(categories, eq(categories.id, posts.categoryId))
    .leftJoin(series, eq(series.id, posts.seriesId))
    .where(and(publishedOnly, eq(posts.slug, slug)))
    .limit(1);

  if (!row) return null;

  const tagsByPost = await loadTags(db, [row.id]);
  return {
    ...toSummary(row, tagsByPost),
    // 보통은 발행 시점에 렌더해 둔 HTML 을 그대로 쓴다.
    // 비어 있는 경우(시드 데이터, 직접 DB 에 넣은 글, 과거 렌더 실패)에는
    // 읽는 시점에 렌더한다. 글이 빈 화면으로 보이는 것보다 낫다.
    contentHtml: row.contentHtml ?? renderMarkdown(row.content),
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    ogImageUrl: row.ogImageUrl,
    allowComments: row.allowComments,
    updatedAt: row.updatedAt,
  };
}

/** 글 상세의 이전/다음 글. */
export async function getAdjacentPosts(db: Db, publishedAt: number, id: number) {
  const [previous, next] = await Promise.all([
    db
      .select({ slug: posts.slug, title: posts.title })
      .from(posts)
      .where(
        and(
          publishedOnly,
          or(
            sql`${posts.publishedAt} < ${publishedAt}`,
            and(sql`${posts.publishedAt} = ${publishedAt}`, sql`${posts.id} < ${id}`),
          ),
        ),
      )
      .orderBy(desc(posts.publishedAt), desc(posts.id))
      .limit(1),
    db
      .select({ slug: posts.slug, title: posts.title })
      .from(posts)
      .where(
        and(
          publishedOnly,
          or(
            sql`${posts.publishedAt} > ${publishedAt}`,
            and(sql`${posts.publishedAt} = ${publishedAt}`, sql`${posts.id} > ${id}`),
          ),
        ),
      )
      .orderBy(posts.publishedAt, posts.id)
      .limit(1),
  ]);

  return { previous: previous[0] ?? null, next: next[0] ?? null };
}

/**
 * 전문 검색.
 *
 * FTS5 의 trigram 토크나이저는 3글자 이상부터 매칭된다.
 * 2글자 이하 질의("개발" 같은 흔한 경우)는 LIKE 스캔으로 폴백한다 —
 * 글이 수백 개 수준이라 전체 스캔도 충분히 싸다.
 * 글이 수천 개를 넘으면 이 폴백을 재검토해야 한다.
 */
export async function searchPosts(db: Db, query: string, limit: number): Promise<PostSummary[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const base = db
    .select(summaryColumns)
    .from(posts)
    .leftJoin(categories, eq(categories.id, posts.categoryId))
    .leftJoin(series, eq(series.id, posts.seriesId));

  let rows: SummaryRow[];

  if (trimmed.length >= 3) {
    // FTS5 질의 문법을 타지 않도록 전체를 구문(phrase)으로 감싼다.
    // 내부의 큰따옴표는 두 번 써서 이스케이프한다.
    const phrase = `"${trimmed.replace(/"/g, '""')}"`;
    rows = await base
      .where(
        and(
          publishedOnly,
          sql`${posts.id} in (select rowid from posts_fts where posts_fts match ${phrase} order by rank limit ${limit})`,
        ),
      )
      .orderBy(desc(posts.publishedAt))
      .limit(limit);
  } else {
    const pattern = `%${trimmed.replace(/[\\%_]/g, '\\$&')}%`;
    rows = await base
      .where(
        and(
          publishedOnly,
          sql`(${posts.title} like ${pattern} escape '\\' or ${posts.summary} like ${pattern} escape '\\')`,
        ),
      )
      .orderBy(desc(posts.publishedAt))
      .limit(limit);
  }

  const tagsByPost = await loadTags(db, rows.map((r) => r.id));
  return rows.map((row) => toSummary(row, tagsByPost));
}

/** 같은 카테고리 또는 태그를 공유하는 글. */
export async function getRelatedPosts(db: Db, postId: number, limit = 4): Promise<PostSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(posts)
    .leftJoin(categories, eq(categories.id, posts.categoryId))
    .leftJoin(series, eq(series.id, posts.seriesId))
    .where(
      and(
        publishedOnly,
        sql`${posts.id} <> ${postId}`,
        sql`(
          ${posts.categoryId} = (select category_id from posts where id = ${postId})
          or exists (
            select 1 from ${postTags} pt
            where pt.post_id = ${posts.id}
              and pt.tag_id in (select tag_id from post_tags where post_id = ${postId})
          )
        )`,
      ),
    )
    .orderBy(desc(posts.publishedAt))
    .limit(limit);

  const tagsByPost = await loadTags(db, rows.map((r) => r.id));
  return rows.map((row) => toSummary(row, tagsByPost));
}

// ---------------------------------------------------------------------------
// 관리자
// ---------------------------------------------------------------------------

export async function listAdminPosts(
  db: Db,
  opts: { limit: number; cursor: Cursor | null; status?: PostStatus },
) {
  const filters = [isNull(posts.deletedAt)];
  if (opts.status) filters.push(eq(posts.status, opts.status));

  if (opts.cursor) {
    const { sortValue, id } = opts.cursor;
    filters.push(
      or(
        sql`${posts.updatedAt} < ${sortValue}`,
        and(sql`${posts.updatedAt} = ${sortValue}`, sql`${posts.id} < ${id}`),
      )!,
    );
  }

  const rows = await db
    .select({
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      status: posts.status,
      publishedAt: posts.publishedAt,
      updatedAt: posts.updatedAt,
      commentCount: posts.commentCount,
      likeCount: posts.likeCount,
      viewCount: posts.viewCount,
      categoryName: categories.name,
    })
    .from(posts)
    .leftJoin(categories, eq(categories.id, posts.categoryId))
    .where(and(...filters))
    .orderBy(desc(posts.updatedAt), desc(posts.id))
    .limit(opts.limit + 1);

  return slicePage(rows, opts.limit, (row) => ({ sortValue: row.updatedAt, id: row.id }));
}

/** 관리자용 단건 조회. 초안·예약 글도 마크다운 원문까지 돌려준다. */
export async function getAdminPost(db: Db, id: number) {
  const [row] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
    .limit(1);
  if (!row) return null;

  const tagRows = await db
    .select({ id: tags.id, slug: tags.slug, name: tags.name })
    .from(postTags)
    .innerJoin(tags, eq(tags.id, postTags.tagId))
    .where(eq(postTags.postId, id));

  return { ...row, tags: tagRows };
}

/** 글의 태그를 통째로 교체한다. */
export async function replacePostTags(db: Db, postId: number, tagIds: number[]) {
  const remove = db.delete(postTags).where(eq(postTags.postId, postId));

  if (tagIds.length === 0) {
    await remove;
    return;
  }

  const insert = db
    .insert(postTags)
    .values(tagIds.map((tagId) => ({ postId, tagId })))
    .onConflictDoNothing();

  // 지우고 넣는 것이 갈라지면 태그가 사라진 상태로 남는다. 원자적으로 처리한다.
  await db.batch([remove, insert]);
}

export async function softDeletePost(db: Db, id: number) {
  const result = await db
    .update(posts)
    .set({ deletedAt: Math.floor(Date.now() / 1000) })
    .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
    .returning({ id: posts.id });
  return result.length > 0;
}
