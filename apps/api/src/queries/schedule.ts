import { createDb, pages, posts } from '@namsu/db';
import { and, eq, sql } from 'drizzle-orm';

/**
 * 발행 시각이 지난 '예약' 항목을 '발행됨' 으로 정리한다.
 *
 * 공개 여부 자체는 이 작업과 무관하다 — visibility.ts 의 조건이 상태와 시각을
 * 함께 보기 때문에, 크론이 늦거나 실패해도 예약 글은 제때 공개된다.
 * 이 작업의 목적은 관리자 목록의 라벨을 맞추는 것뿐이다.
 * 이미 공개된 글이 '예약' 으로 표시되어 있으면 혼란스럽다.
 */
export async function publishDueContent(d1: D1Database): Promise<{ posts: number; pages: number }> {
  const db = createDb(d1);
  const due = sql`${posts.publishedAt} <= unixepoch()`;

  const [updatedPosts, updatedPages] = await db.batch([
    db
      .update(posts)
      .set({ status: 'published' })
      .where(and(eq(posts.status, 'scheduled'), due))
      .returning({ id: posts.id }),
    db
      .update(pages)
      .set({ status: 'published' })
      .where(and(eq(pages.status, 'scheduled'), sql`${pages.publishedAt} <= unixepoch()`))
      .returning({ id: pages.id }),
  ]);

  return { posts: updatedPosts.length, pages: updatedPages.length };
}
