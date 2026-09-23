import { comments, posts, type CommentStatus, type Db } from '@namsu/db';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';

import { ApiError } from '../lib/errors';
import { type Cursor, slicePage } from '../lib/pagination';
import { visiblePost } from './visibility';

/** 대댓글 최대 깊이. 0 = 최상위. 너무 깊어지면 모바일에서 읽기 어렵다. */
const MAX_REPLY_DEPTH = 2;

export interface PublicComment {
  id: number;
  parentId: number | null;
  authorName: string;
  authorWebsite: string | null;
  body: string;
  isOwner: boolean;
  /** 비밀 댓글이면 authorName 과 body 가 비어 있다. 잠금 표시만 렌더한다. */
  isSecret: boolean;
  createdAt: number;
  replies: PublicComment[];
}

/**
 * 공개 댓글 조회.
 *
 * author_email 은 여기서 절대 SELECT 하지 않는다.
 * 답글 알림과 아바타 해시에만 쓰는 값이고, 공개 응답에 섞여 들어가면
 * 되돌릴 수 없다. "응답 타입에서 빼는" 것으로는 부족하고
 * 애초에 DB 에서 읽지 않는 것이 확실하다.
 */
export async function listApprovedComments(db: Db, postId: number): Promise<PublicComment[]> {
  const rows = await db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      authorName: comments.authorName,
      authorWebsite: comments.authorWebsite,
      body: comments.body,
      isOwner: comments.isOwner,
      isSecret: comments.isSecret,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .where(
      and(eq(comments.postId, postId), eq(comments.status, 'approved'), isNull(comments.deletedAt)),
    )
    .orderBy(asc(comments.createdAt));

  const nodes = new Map<number, PublicComment>();
  for (const row of rows) {
    // 비밀 댓글은 존재만 알리고 내용을 비운다.
    // 여기서 비우지 않으면 글 페이지가 엣지에 캐시될 때 본문이 통째로 새어나간다.
    nodes.set(row.id, {
      ...row,
      authorName: row.isSecret ? '' : row.authorName,
      authorWebsite: row.isSecret ? null : row.authorWebsite,
      body: row.isSecret ? '' : row.body,
      replies: [],
    });
  }

  const roots: PublicComment[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId == null ? null : nodes.get(node.parentId);
    // 부모가 승인되지 않아 목록에 없으면 최상위로 올린다 (고아 댓글이 사라지지 않게).
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }
  return roots;
}

export interface CreateCommentInput {
  postId: number;
  parentId: number | null;
  authorName: string;
  authorEmail: string | null;
  authorWebsite: string | null;
  body: string;
  visitorHash: string;
  userAgent: string | null;
  autoApprove: boolean;
  isSecret: boolean;
  /** 관리자(주인)가 다는 답글인지. 배지 표시에 쓴다. */
  isOwner?: boolean;
}

export async function createComment(db: Db, input: CreateCommentInput) {
  // 부모가 비밀이면 아래에서 true 로 덮어쓴다.
  let isSecret = input.isSecret;

  const [post] = await db
    .select({ id: posts.id, allowComments: posts.allowComments })
    .from(posts)
    .where(and(eq(posts.id, input.postId), visiblePost))
    .limit(1);

  if (!post) throw ApiError.notFound('글을 찾을 수 없습니다.');
  if (!post.allowComments) throw ApiError.forbidden('이 글은 댓글을 받지 않습니다.');

  if (input.parentId != null) {
    const [parent] = await db
      .select({
        id: comments.id,
        postId: comments.postId,
        parentId: comments.parentId,
        status: comments.status,
        isSecret: comments.isSecret,
      })
      .from(comments)
      .where(and(eq(comments.id, input.parentId), isNull(comments.deletedAt)))
      .limit(1);

    if (!parent || parent.postId !== input.postId) {
      throw ApiError.badRequest('답글을 달 댓글을 찾을 수 없습니다.');
    }
    if (parent.status !== 'approved') {
      throw ApiError.badRequest('아직 공개되지 않은 댓글에는 답글을 달 수 없습니다.');
    }

    const depth = await replyDepth(db, parent.id);
    if (depth >= MAX_REPLY_DEPTH) {
      throw ApiError.unprocessable('답글은 이 단계까지만 달 수 있습니다.');
    }

    // 비밀 댓글의 답글은 무조건 비밀이다. 공개로 두면 답글이 원문의 맥락을
    // 흘린다 — "네, 그 부분은 ... 입니다" 만으로도 질문이 짐작된다.
    if (parent.isSecret) isSecret = true;
  }

  const [row] = await db
    .insert(comments)
    .values({
      postId: input.postId,
      parentId: input.parentId,
      authorName: input.authorName,
      authorEmail: input.authorEmail,
      authorWebsite: input.authorWebsite,
      body: input.body,
      visitorHash: input.visitorHash,
      userAgent: input.userAgent,
      isSecret,
      isOwner: input.isOwner ?? false,
      status: input.autoApprove ? 'approved' : 'pending',
    })
    .returning({
      id: comments.id,
      status: comments.status,
      isSecret: comments.isSecret,
      createdAt: comments.createdAt,
    });

  return row!;
}

/** 조상을 거슬러 올라가며 깊이를 센다. MAX_REPLY_DEPTH 가 작아 왕복도 적다. */
async function replyDepth(db: Db, commentId: number): Promise<number> {
  let depth = 0;
  let cursor: number | null = commentId;

  while (cursor != null && depth <= MAX_REPLY_DEPTH) {
    const [row]: { parentId: number | null }[] = await db
      .select({ parentId: comments.parentId })
      .from(comments)
      .where(eq(comments.id, cursor))
      .limit(1);
    if (!row) break;
    cursor = row.parentId;
    if (cursor != null) depth += 1;
  }
  return depth;
}

/**
 * 알림 메일을 만들 때 필요한 원댓글 정보.
 * author_email 은 공개 응답에 절대 싣지 않지만, 답글 알림에는 필요하다.
 */
export async function getCommentForNotify(db: Db, id: number) {
  const [row] = await db
    .select({
      id: comments.id,
      authorName: comments.authorName,
      authorEmail: comments.authorEmail,
      body: comments.body,
      isSecret: comments.isSecret,
    })
    .from(comments)
    .where(and(eq(comments.id, id), isNull(comments.deletedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * 같은 방문자가 방금 똑같은 내용을 또 보냈는지 본다.
 * 더블클릭이나 재전송으로 같은 댓글이 두 번 달리는 것을 막는다.
 */
export async function isDuplicateComment(
  db: Db,
  visitorHash: string,
  postId: number,
  body: string,
): Promise<boolean> {
  const since = Math.floor(Date.now() / 1000) - 300; // 5분
  const [row] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(
      and(
        eq(comments.visitorHash, visitorHash),
        eq(comments.postId, postId),
        eq(comments.body, body),
        sql`${comments.createdAt} > ${since}`,
      ),
    )
    .limit(1);
  return row != null;
}

// ---------------------------------------------------------------------------
// 관리자 (모더레이션)
// ---------------------------------------------------------------------------

export async function listCommentsForModeration(
  db: Db,
  opts: { limit: number; cursor: Cursor | null; status?: CommentStatus },
) {
  /*
   * 삭제는 소프트 삭제다 (deleted_at 이 찍히고 status 가 'deleted' 가 된다).
   * 다른 탭에서는 삭제된 것을 빼야 하지만, 삭제 탭에서는 그것만 보여야 한다.
   * 예전에는 이 구분이 없어서 삭제 탭이 늘 비어 있었다.
   */
  const filters =
    opts.status === 'deleted'
      ? [sql`${comments.deletedAt} is not null`]
      : [isNull(comments.deletedAt)];

  if (opts.status && opts.status !== 'deleted') filters.push(eq(comments.status, opts.status));

  if (opts.cursor) {
    const { sortValue, id } = opts.cursor;
    filters.push(
      or(
        sql`${comments.createdAt} < ${sortValue}`,
        and(sql`${comments.createdAt} = ${sortValue}`, sql`${comments.id} < ${id}`),
      )!,
    );
  }

  const rows = await db
    .select({
      id: comments.id,
      postId: comments.postId,
      postSlug: posts.slug,
      postTitle: posts.title,
      parentId: comments.parentId,
      authorName: comments.authorName,
      // 관리자 화면에서는 이메일을 보여준다 (스팸 판단과 답장에 필요하다).
      authorEmail: comments.authorEmail,
      authorWebsite: comments.authorWebsite,
      body: comments.body,
      status: comments.status,
      isSecret: comments.isSecret,
      isOwner: comments.isOwner,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .innerJoin(posts, eq(posts.id, comments.postId))
    .where(and(...filters))
    .orderBy(desc(comments.createdAt), desc(comments.id))
    .limit(opts.limit + 1);

  return slicePage(rows, opts.limit, (row) => ({ sortValue: row.createdAt, id: row.id }));
}

export async function setCommentStatus(db: Db, id: number, status: CommentStatus) {
  const result = await db
    .update(comments)
    .set({ status })
    .where(and(eq(comments.id, id), isNull(comments.deletedAt)))
    .returning({ id: comments.id, status: comments.status });

  if (result.length === 0) throw ApiError.notFound('댓글을 찾을 수 없습니다.');
  return result[0]!;
}

/**
 * 삭제한 댓글을 되살린다.
 * 소프트 삭제라 내용이 남아 있으므로 deleted_at 만 지우면 된다.
 */
export async function restoreComment(db: Db, id: number) {
  const result = await db
    .update(comments)
    .set({ deletedAt: null, status: 'approved' })
    .where(and(eq(comments.id, id), sql`${comments.deletedAt} is not null`))
    .returning({ id: comments.id, status: comments.status });

  if (result.length === 0) throw ApiError.notFound('삭제된 댓글을 찾을 수 없습니다.');
  return result[0]!;
}

/**
 * 댓글 소프트 삭제.
 * 하드 삭제하면 대댓글이 ON DELETE CASCADE 로 같이 사라진다.
 */
export async function softDeleteComment(db: Db, id: number) {
  const result = await db
    .update(comments)
    .set({ deletedAt: Math.floor(Date.now() / 1000), status: 'deleted' })
    .where(and(eq(comments.id, id), isNull(comments.deletedAt)))
    .returning({ id: comments.id });

  if (result.length === 0) throw ApiError.notFound('댓글을 찾을 수 없습니다.');
}
