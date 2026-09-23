import { pages, posts } from '@namsu/db';
import { and, inArray, isNull, sql } from 'drizzle-orm';

/**
 * 공개 노출 조건.
 *
 * 이 조건이 공개 API 전체의 유일한 기준이다. 예전에는 같은 조건이 여덟 군데에
 * 흩어져 있었고, 한 곳만 빠뜨려도 초안이 새어나갈 수 있는 구조였다.
 *
 * 시각 비교가 핵심이다. 이전에는 status 만 보고 published_at 을 보지 않아서
 *   - '예약' 은 시간이 지나도 영영 공개되지 않았고 (자동 발행 로직이 없다)
 *   - '발행됨' 은 발행 시각을 미래로 둬도 즉시 공개됐다
 * 두 가지 모두 관리자 화면의 안내와 어긋났다.
 *
 * 이제 상태와 시각을 함께 본다. 덕분에 예약 발행이 크론 없이도 제때 공개되고,
 * 미래로 잡아둔 발행 글은 그 시각까지 숨는다.
 * (크론은 뒤늦게 status 를 'published' 로 정리해 관리자 목록의 라벨을 맞춘다.
 *  공개 여부 자체는 크론과 무관하게 이 조건만으로 결정된다.)
 */
export const visiblePost = and(
  inArray(posts.status, ['published', 'scheduled']),
  isNull(posts.deletedAt),
  sql`${posts.publishedAt} <= unixepoch()`,
);

/** 단독 페이지(/about, /now ...)의 공개 조건. 글과 같은 규칙을 쓴다. */
export const visiblePage = and(
  inArray(pages.status, ['published', 'scheduled']),
  sql`${pages.publishedAt} <= unixepoch()`,
);
