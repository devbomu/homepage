import { sql } from 'drizzle-orm';

/**
 * 여러 행의 정렬 순서를 한 번에 맞춘다.
 *
 * 드래그 한 번에 여러 행이 밀리므로 행마다 PATCH 를 보내면 왕복이 그만큼 늘고,
 * 중간에 하나가 실패하면 순서가 반쯤 적용된 채로 남는다. CASE 하나로 묶어
 * 한 문장에 끝낸다 — 성공하거나 아무것도 안 바뀌거나 둘 중 하나다.
 *
 * 테이블 이름은 호출부가 고정 문자열로만 넘긴다 (사용자 입력이 닿지 않는다).
 */
export function reorderSql(table: 'categories' | 'pages' | 'projects', ids: number[]) {
  const cases = sql.join(
    ids.map((id, index) => sql`when ${id} then ${index}`),
    sql` `,
  );
  return sql`update ${sql.identifier(table)} set sort_order = case id ${cases} end
    where id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})`;
}
