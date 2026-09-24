import { COMMENT_STATUSES, guestbook, type CommentStatus, type Db } from '@namsu/db';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';

import { ApiError } from '../lib/errors';
import { type Cursor, slicePage } from '../lib/pagination';

export interface GuestbookEntry {
  id: number;
  authorName: string;
  authorWebsite: string | null;
  body: string;
  createdAt: number;
}

/**
 * 공개 방명록.
 *
 * author_email 은 여기서 절대 SELECT 하지 않는다 — 댓글과 같은 규칙이다.
 * 응답 타입에서 빼는 것으로는 부족하고, 애초에 DB 에서 읽지 않는 것이 확실하다.
 */
export async function listGuestbook(db: Db, opts: { limit: number; cursor: Cursor | null }) {
  const filters = [eq(guestbook.status, 'approved'), isNull(guestbook.deletedAt)];

  if (opts.cursor) {
    const { sortValue, id } = opts.cursor;
    filters.push(
      or(
        sql`${guestbook.createdAt} < ${sortValue}`,
        and(sql`${guestbook.createdAt} = ${sortValue}`, sql`${guestbook.id} < ${id}`),
      )!,
    );
  }

  const rows = await db
    .select({
      id: guestbook.id,
      authorName: guestbook.authorName,
      authorWebsite: guestbook.authorWebsite,
      body: guestbook.body,
      createdAt: guestbook.createdAt,
    })
    .from(guestbook)
    .where(and(...filters))
    .orderBy(desc(guestbook.createdAt), desc(guestbook.id))
    .limit(opts.limit + 1);

  return slicePage(rows, opts.limit, (row) => ({ sortValue: row.createdAt, id: row.id }));
}

export async function countGuestbook(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(guestbook)
    .where(and(eq(guestbook.status, 'approved'), isNull(guestbook.deletedAt)));
  return row?.n ?? 0;
}

export interface CreateGuestbookInput {
  authorName: string;
  authorEmail: string | null;
  authorWebsite: string | null;
  body: string;
  visitorHash: string;
  userAgent: string | null;
  autoApprove: boolean;
}

export async function createGuestbookEntry(db: Db, input: CreateGuestbookInput) {
  const [row] = await db
    .insert(guestbook)
    .values({
      authorName: input.authorName,
      authorEmail: input.authorEmail,
      authorWebsite: input.authorWebsite,
      body: input.body,
      visitorHash: input.visitorHash,
      userAgent: input.userAgent,
      status: input.autoApprove ? 'approved' : 'pending',
    })
    .returning({
      id: guestbook.id,
      status: guestbook.status,
      createdAt: guestbook.createdAt,
    });

  return row!;
}

/**
 * 같은 방문자가 방금 똑같은 내용을 또 보냈는지 본다.
 * 더블클릭이나 재전송으로 같은 글이 두 번 남는 것을 막는다.
 */
export async function isDuplicateGuestbookEntry(
  db: Db,
  visitorHash: string,
  body: string,
): Promise<boolean> {
  const since = Math.floor(Date.now() / 1000) - 300; // 5분
  const [row] = await db
    .select({ id: guestbook.id })
    .from(guestbook)
    .where(
      and(
        eq(guestbook.visitorHash, visitorHash),
        eq(guestbook.body, body),
        sql`${guestbook.createdAt} > ${since}`,
      ),
    )
    .limit(1);
  return row != null;
}

// ---------------------------------------------------------------------------
// 관리자
// ---------------------------------------------------------------------------

export async function listGuestbookForModeration(
  db: Db,
  opts: { limit: number; cursor: Cursor | null; status?: CommentStatus },
) {
  // 삭제는 소프트 삭제다. 삭제 탭에서만 그것을 보여준다 (댓글과 같은 규칙).
  const filters =
    opts.status === 'deleted'
      ? [sql`${guestbook.deletedAt} is not null`]
      : [isNull(guestbook.deletedAt)];

  if (opts.status && opts.status !== 'deleted') filters.push(eq(guestbook.status, opts.status));

  if (opts.cursor) {
    const { sortValue, id } = opts.cursor;
    filters.push(
      or(
        sql`${guestbook.createdAt} < ${sortValue}`,
        and(sql`${guestbook.createdAt} = ${sortValue}`, sql`${guestbook.id} < ${id}`),
      )!,
    );
  }

  const rows = await db
    .select({
      id: guestbook.id,
      authorName: guestbook.authorName,
      // 관리자 화면에서는 이메일을 보여준다 (스팸 판단과 답장에 필요하다).
      authorEmail: guestbook.authorEmail,
      authorWebsite: guestbook.authorWebsite,
      body: guestbook.body,
      status: guestbook.status,
      createdAt: guestbook.createdAt,
    })
    .from(guestbook)
    .where(and(...filters))
    .orderBy(desc(guestbook.createdAt), desc(guestbook.id))
    .limit(opts.limit + 1);

  return slicePage(rows, opts.limit, (row) => ({ sortValue: row.createdAt, id: row.id }));
}

export async function setGuestbookStatus(db: Db, id: number, status: CommentStatus) {
  if (!COMMENT_STATUSES.includes(status)) throw ApiError.badRequest('알 수 없는 상태입니다.');

  const result = await db
    .update(guestbook)
    .set({ status })
    .where(and(eq(guestbook.id, id), isNull(guestbook.deletedAt)))
    .returning({ id: guestbook.id, status: guestbook.status });

  if (result.length === 0) throw ApiError.notFound('방명록 글을 찾을 수 없습니다.');
  return result[0]!;
}

/** 소프트 삭제. 내용을 남겨 두어야 되살릴 수 있다. */
export async function softDeleteGuestbookEntry(db: Db, id: number) {
  const result = await db
    .update(guestbook)
    .set({ deletedAt: Math.floor(Date.now() / 1000), status: 'deleted' })
    .where(and(eq(guestbook.id, id), isNull(guestbook.deletedAt)))
    .returning({ id: guestbook.id });

  if (result.length === 0) throw ApiError.notFound('방명록 글을 찾을 수 없습니다.');
}

export async function restoreGuestbookEntry(db: Db, id: number) {
  const result = await db
    .update(guestbook)
    .set({ deletedAt: null, status: 'approved' })
    .where(and(eq(guestbook.id, id), sql`${guestbook.deletedAt} is not null`))
    .returning({ id: guestbook.id, status: guestbook.status });

  if (result.length === 0) throw ApiError.notFound('삭제된 방명록 글을 찾을 수 없습니다.');
  return result[0]!;
}
