import { postLikes, posts, postViewDaily, type Db } from '@namsu/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { ApiError } from '../lib/errors';

async function findPublishedPostId(db: Db, slug: string): Promise<number> {
  const [row] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.slug, slug), eq(posts.status, 'published'), isNull(posts.deletedAt)))
    .limit(1);
  if (!row) throw ApiError.notFound('글을 찾을 수 없습니다.');
  return row.id;
}

export async function hasLiked(db: Db, postId: number, visitorHash: string): Promise<boolean> {
  const [row] = await db
    .select({ id: postLikes.id })
    .from(postLikes)
    .where(and(eq(postLikes.postId, postId), eq(postLikes.visitorHash, visitorHash)))
    .limit(1);
  return row != null;
}

/**
 * 좋아요 토글.
 *
 * like_count 는 직접 건드리지 않는다 — post_likes 의 INSERT/DELETE 트리거가 맞춘다.
 * 양쪽에서 세면 반드시 어긋난다.
 */
export async function toggleLike(db: Db, slug: string, visitorHash: string) {
  const postId = await findPublishedPostId(db, slug);

  const removed = await db
    .delete(postLikes)
    .where(and(eq(postLikes.postId, postId), eq(postLikes.visitorHash, visitorHash)))
    .returning({ id: postLikes.id });

  if (removed.length > 0) {
    const count = await currentLikeCount(db, postId);
    return { liked: false, likeCount: count };
  }

  // UNIQUE(post_id, visitor_hash) 가 있으므로 동시 요청이 겹쳐도 중복으로 들어가지 않는다.
  await db.insert(postLikes).values({ postId, visitorHash }).onConflictDoNothing();

  const count = await currentLikeCount(db, postId);
  return { liked: true, likeCount: count };
}

async function currentLikeCount(db: Db, postId: number): Promise<number> {
  const [row] = await db.select({ likeCount: posts.likeCount }).from(posts).where(eq(posts.id, postId)).limit(1);
  return row?.likeCount ?? 0;
}

export async function getLikeState(db: Db, slug: string, visitorHash: string) {
  const postId = await findPublishedPostId(db, slug);
  const [liked, count] = await Promise.all([
    hasLiked(db, postId, visitorHash),
    currentLikeCount(db, postId),
  ]);
  return { liked, likeCount: count };
}

/**
 * 조회수 기록.
 *
 * 누적 합계(posts.view_count)와 일별 롤업(post_view_daily)을 같이 올린다.
 * 같은 방문자의 중복 조회는 엣지 레이트리밋이 걸러주므로 여기서는 따지지 않는다.
 */
export async function recordView(db: Db, slug: string): Promise<void> {
  const postId = await findPublishedPostId(db, slug);
  const day = new Date().toISOString().slice(0, 10);

  await db.batch([
    db
      .update(posts)
      .set({
        viewCount: sql`${posts.viewCount} + 1`,
        // 조회수 때문에 updated_at 이 흔들리면 안 된다 (목록 정렬과 캐시 무효화에 쓰인다).
        updatedAt: sql`${posts.updatedAt}`,
      })
      .where(eq(posts.id, postId)),
    db
      .insert(postViewDaily)
      .values({ postId, day, views: 1 })
      .onConflictDoUpdate({
        target: [postViewDaily.postId, postViewDaily.day],
        set: { views: sql`${postViewDaily.views} + 1` },
      }),
  ]);
}
