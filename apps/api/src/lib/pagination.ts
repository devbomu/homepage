import { ApiError } from './errors';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export function parseLimit(raw: string | undefined, fallback = DEFAULT_LIMIT): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_LIMIT);
}

/**
 * 커서 기반 페이지네이션.
 *
 * OFFSET 을 쓰지 않는 이유는 두 가지다.
 * 1) 글이 새로 발행되면 페이지 경계가 밀려 중복/누락이 생긴다.
 * 2) D1 은 읽은 row 수로 과금하는데, OFFSET 은 건너뛴 row 도 읽는다.
 *
 * 커서는 정렬키 (publishedAt, id) 를 그대로 담는다. 서명하지 않는다 —
 * 공개 목록의 위치 정보라 위조해도 얻을 것이 없고, 잘못된 값은 조회 결과가 빌 뿐이다.
 */
export interface Cursor {
  sortValue: number;
  id: number;
}

export function encodeCursor(cursor: Cursor): string {
  return btoa(`${cursor.sortValue}:${cursor.id}`);
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const [sortValue, id] = atob(raw).split(':');
    const parsed = { sortValue: Number(sortValue), id: Number(id) };
    if (!Number.isFinite(parsed.sortValue) || !Number.isFinite(parsed.id)) {
      throw new Error('cursor 에 숫자가 아닌 값이 들어 있습니다');
    }
    return parsed;
  } catch (cause) {
    throw ApiError.badRequest('cursor 값이 올바르지 않습니다.');
  }
}

/**
 * limit + 1 개를 읽어 다음 페이지 존재 여부를 판단한다.
 * (별도의 COUNT 쿼리를 돌리지 않기 위함이다.)
 */
export function slicePage<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => Cursor,
): { items: T[]; nextCursor: string | null; hasMore: boolean } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(toCursor(last)) : null,
  };
}
