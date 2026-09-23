/**
 * @namsu/db — D1 스키마와 공용 헬퍼.
 *
 * 쿼리 자체는 각 앱(주로 apps/api)에 둔다. 이 패키지는 스키마와
 * 여러 앱이 공유해야 하는 타입·상수만 내보낸다.
 */
import { drizzle } from 'drizzle-orm/d1';

import * as schema from './schema';

export * from './schema';

/** D1 바인딩을 Drizzle 인스턴스로 감싼다. */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema, logger: false });
}

export type Db = ReturnType<typeof createDb>;

/**
 * 카테고리 path 유틸.
 *
 * path 는 조상 slug 를 '/' 로 이은 문자열이다 ('dev/backend/go').
 * 트리 조작이 이 규칙 하나에 의존하므로 계산을 한곳에 모아둔다.
 */
export const categoryPath = {
  /** 부모 path 와 자식 slug 로 자식 path 를 만든다. */
  child(parentPath: string | null, slug: string): string {
    return parentPath ? `${parentPath}/${slug}` : slug;
  },

  /** path 의 깊이 (루트 = 0). */
  depth(path: string): number {
    return path.split('/').length - 1;
  },

  /** 'dev/backend/go' -> ['dev', 'dev/backend', 'dev/backend/go'] (브레드크럼용) */
  ancestors(path: string): string[] {
    const parts = path.split('/');
    return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  },

  /** 자기 자신과 모든 자손을 찾는 LIKE 패턴. */
  descendantPattern(path: string): string {
    // LIKE 특수문자를 이스케이프한다. slug 규칙상 '%' 와 '_' 는
    // '%' 는 못 들어오지만 '_' 는 가능하므로 반드시 처리해야 한다.
    return `${path.replace(/[\\%_]/g, '\\$&')}/%`;
  },
};

/** 글 상태 중 공개 사이트에 보여도 되는 것. */
export const PUBLIC_POST_STATUS = 'published' as const;
