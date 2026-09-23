import { comments, createDb, postLikes, posts, postViewDaily } from '@namsu/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import type { AppEnv } from '../../env';
import { ok } from '../../lib/response';

export const adminStats = new Hono<AppEnv>();

/** GET /v1/admin/stats — 관리자 대시보드 요약. */
adminStats.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const since = Math.floor(Date.now() / 1000) - 30 * 86400;

  const [postCounts, totals, pendingComments, recentViews, topPosts] = await Promise.all([
    db
      .select({ status: posts.status, n: sql<number>`count(*)` })
      .from(posts)
      .where(isNull(posts.deletedAt))
      .groupBy(posts.status),

    db
      .select({
        views: sql<number>`coalesce(sum(${posts.viewCount}), 0)`,
        likes: sql<number>`coalesce(sum(${posts.likeCount}), 0)`,
        comments: sql<number>`coalesce(sum(${posts.commentCount}), 0)`,
      })
      .from(posts)
      .where(and(eq(posts.status, 'published'), isNull(posts.deletedAt))),

    db
      .select({ n: sql<number>`count(*)` })
      .from(comments)
      .where(and(eq(comments.status, 'pending'), isNull(comments.deletedAt))),

    // 최근 30일 일별 조회수 추이
    db
      .select({ day: postViewDaily.day, views: sql<number>`sum(${postViewDaily.views})` })
      .from(postViewDaily)
      .where(sql`${postViewDaily.day} >= date(${since}, 'unixepoch')`)
      .groupBy(postViewDaily.day)
      .orderBy(postViewDaily.day),

    db
      .select({
        slug: posts.slug,
        title: posts.title,
        viewCount: posts.viewCount,
        likeCount: posts.likeCount,
        commentCount: posts.commentCount,
      })
      .from(posts)
      .where(and(eq(posts.status, 'published'), isNull(posts.deletedAt)))
      .orderBy(desc(posts.viewCount))
      .limit(10),
  ]);

  const byStatus: Record<string, number> = { draft: 0, scheduled: 0, published: 0, archived: 0 };
  for (const row of postCounts) byStatus[row.status] = row.n;

  return ok(c, {
    posts: byStatus,
    totals: totals[0] ?? { views: 0, likes: 0, comments: 0 },
    pendingComments: pendingComments[0]?.n ?? 0,
    viewsByDay: recentViews,
    topPosts,
  });
});

/** GET /v1/admin/stats/posts/:id — 글 하나의 상세 지표. */
adminStats.get('/posts/:id{[0-9]+}', async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));

  const [daily, likes] = await Promise.all([
    db
      .select({ day: postViewDaily.day, views: postViewDaily.views })
      .from(postViewDaily)
      .where(eq(postViewDaily.postId, id))
      .orderBy(desc(postViewDaily.day))
      .limit(90),
    db.select({ n: sql<number>`count(*)` }).from(postLikes).where(eq(postLikes.postId, id)),
  ]);

  return ok(c, { viewsByDay: daily.reverse(), likes: likes[0]?.n ?? 0 });
});
