import { categories, categoryPath, posts, postTags, series, tags, type Db } from '@namsu/db';
import { and, asc, count, eq, isNull, or, sql } from 'drizzle-orm';

import { ApiError } from '../lib/errors';

// ---------------------------------------------------------------------------
// 카테고리
// ---------------------------------------------------------------------------

/**
 * 어떤 path 의 자손 전체를 고르는 조건.
 *
 * slug 에는 LIKE 와일드카드(_ , %)가 들어올 수 있어서 패턴을 이스케이프하는데,
 * SQLite 는 ESCAPE 절이 있어야 그 백슬래시를 이스케이프 문자로 인정한다.
 * 이 절을 빠뜨리면 '_' 가 들어간 경로에서 조용히 빈 결과가 나온다 —
 * 조회는 그렇다 쳐도, 카테고리를 옮길 때 자손 갱신이 통째로 누락되어
 * 트리가 소리 없이 깨진다.
 */
function descendantsOf(path: string) {
  return sql`${categories.path} like ${categoryPath.descendantPattern(path)} escape '\\'`;
}

export interface CategoryNode {
  id: number;
  parentId: number | null;
  slug: string;
  name: string;
  description: string | null;
  path: string;
  depth: number;
  sortOrder: number;
  postCount: number;
  children: CategoryNode[];
}

/**
 * 카테고리 전체를 한 번에 읽고 메모리에서 트리로 조립한다.
 *
 * 재귀 CTE 를 쓰지 않는 이유: 카테고리는 많아야 수십 개라
 * 전부 읽어도 비용이 무시할 수준이고, 깊이별로 쿼리를 나누면
 * D1 왕복이 늘어나 오히려 느리다.
 *
 * 글 수는 비정규화하지 않고 여기서 센다 (상태 전이마다 카운터를 맞추는
 * 복잡도 대비 이득이 작다). 발행된 글만, 그리고 하위 트리까지 합산한다.
 */
export async function getCategoryTree(db: Db): Promise<CategoryNode[]> {
  const [rows, counts] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.id)),
    db
      .select({ categoryId: posts.categoryId, n: count() })
      .from(posts)
      .where(and(eq(posts.status, 'published'), isNull(posts.deletedAt)))
      .groupBy(posts.categoryId),
  ]);

  const directCount = new Map<number, number>();
  for (const row of counts) {
    if (row.categoryId != null) directCount.set(row.categoryId, row.n);
  }

  const nodes = new Map<number, CategoryNode>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      parentId: row.parentId,
      slug: row.slug,
      name: row.name,
      description: row.description,
      path: row.path,
      depth: row.depth,
      sortOrder: row.sortOrder,
      postCount: directCount.get(row.id) ?? 0,
      children: [],
    });
  }

  // 자손의 글 수를 조상에 더한다. 깊은 것부터 올라가면 한 번에 끝난다.
  const byDepthDesc = [...nodes.values()].sort((a, b) => b.depth - a.depth);
  for (const node of byDepthDesc) {
    if (node.parentId == null) continue;
    const parent = nodes.get(node.parentId);
    if (parent) parent.postCount += node.postCount;
  }

  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId == null ? null : nodes.get(node.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}

export async function getCategoryByPath(db: Db, path: string) {
  const [row] = await db.select().from(categories).where(eq(categories.path, path)).limit(1);
  return row ?? null;
}

/** 브레드크럼용. 'dev/backend/go' -> 루트부터 자기까지. */
export async function getCategoryAncestors(db: Db, path: string) {
  const paths = categoryPath.ancestors(path);
  if (paths.length === 0) return [];

  const rows = await db
    .select({ slug: categories.slug, name: categories.name, path: categories.path })
    .from(categories)
    .where(sql`${categories.path} in ${paths}`);

  // 쿼리 결과 순서는 보장되지 않으므로 경로 순서대로 다시 정렬한다.
  const byPath = new Map(rows.map((r) => [r.path, r]));
  return paths.map((p) => byPath.get(p)).filter((r): r is NonNullable<typeof r> => r != null);
}

/**
 * 자기 자신과 모든 자손 카테고리의 id.
 * 'dev' 를 고르면 'dev/backend/go' 의 글까지 같이 나와야 한다.
 */
export async function getDescendantCategoryIds(db: Db, path: string): Promise<number[]> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(or(eq(categories.path, path), descendantsOf(path)));
  return rows.map((r) => r.id);
}

/**
 * 카테고리를 만든다. path 와 depth 는 부모로부터 계산한다 (호출자가 정하지 않는다).
 */
export async function createCategory(
  db: Db,
  input: {
    parentId: number | null;
    slug: string;
    name: string;
    description?: string | null;
    sortOrder?: number;
  },
) {
  let parentPath: string | null = null;
  let depth = 0;

  if (input.parentId != null) {
    const [parent] = await db
      .select({ path: categories.path, depth: categories.depth })
      .from(categories)
      .where(eq(categories.id, input.parentId))
      .limit(1);
    if (!parent) throw ApiError.badRequest('상위 카테고리를 찾을 수 없습니다.');

    parentPath = parent.path;
    depth = parent.depth + 1;
    if (depth > 5) throw ApiError.unprocessable('카테고리는 6단계까지만 만들 수 있습니다.');
  }

  const path = categoryPath.child(parentPath, input.slug);

  const [row] = await db
    .insert(categories)
    .values({
      parentId: input.parentId,
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      path,
      depth,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();

  return row!;
}

/**
 * 카테고리를 옮기거나 이름을 바꾼다.
 *
 * slug 나 부모가 바뀌면 자기 path 뿐 아니라 **모든 자손의 path 도** 따라 바뀌어야 한다.
 * 이 갱신을 빠뜨리면 트리가 조용히 깨진다 (하위 조회가 빈 결과를 낸다).
 */
export async function updateCategory(
  db: Db,
  id: number,
  input: {
    parentId?: number | null;
    slug?: string;
    name?: string;
    description?: string | null;
    sortOrder?: number;
  },
) {
  const [current] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  if (!current) throw ApiError.notFound('카테고리를 찾을 수 없습니다.');

  const nextParentId = input.parentId === undefined ? current.parentId : input.parentId;
  const nextSlug = input.slug ?? current.slug;
  const pathChanges = nextParentId !== current.parentId || nextSlug !== current.slug;

  let nextPath = current.path;
  let nextDepth = current.depth;

  if (pathChanges) {
    let parentPath: string | null = null;
    nextDepth = 0;

    if (nextParentId != null) {
      if (nextParentId === id)
        throw ApiError.unprocessable('자기 자신을 상위로 지정할 수 없습니다.');

      const [parent] = await db
        .select({ path: categories.path, depth: categories.depth })
        .from(categories)
        .where(eq(categories.id, nextParentId))
        .limit(1);
      if (!parent) throw ApiError.badRequest('상위 카테고리를 찾을 수 없습니다.');

      // 자기 자손을 부모로 지정하면 트리가 순환한다.
      if (parent.path === current.path || parent.path.startsWith(`${current.path}/`)) {
        throw ApiError.unprocessable('하위 카테고리를 상위로 지정할 수 없습니다.');
      }

      parentPath = parent.path;
      nextDepth = parent.depth + 1;
    }

    nextPath = categoryPath.child(parentPath, nextSlug);
  }

  const updateSelf = db
    .update(categories)
    .set({
      parentId: nextParentId,
      slug: nextSlug,
      name: input.name ?? current.name,
      description: input.description === undefined ? current.description : input.description,
      sortOrder: input.sortOrder ?? current.sortOrder,
      path: nextPath,
      depth: nextDepth,
    })
    .where(eq(categories.id, id));

  if (!pathChanges) {
    await updateSelf;
  } else {
    // 자손들의 path 앞부분을 새 경로로 갈아끼우고 depth 를 같은 폭만큼 옮긴다.
    // substr 의 시작 위치는 1-based 라 옛 경로 길이 + 1 부터 잘라낸다.
    const updateDescendants = db
      .update(categories)
      .set({
        path: sql`${nextPath} || substr(${categories.path}, ${current.path.length + 1})`,
        depth: sql`${categories.depth} + ${nextDepth - current.depth}`,
      })
      .where(descendantsOf(current.path));

    // D1 batch 는 원자적이다. 자손 갱신이 실패하면 본인 갱신도 롤백된다.
    // 이 둘이 갈라지면 트리가 조용히 깨지므로 반드시 같이 성공해야 한다.
    await db.batch([updateSelf, updateDescendants]);
  }

  const [updated] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  return updated!;
}

/**
 * 카테고리를 지운다.
 *
 * 스키마의 ON DELETE RESTRICT 가 자식 있는 카테고리 삭제를 막지만,
 * 그대로 두면 사용자는 알 수 없는 외래키 에러를 보게 된다.
 * 여기서 먼저 확인해 읽을 수 있는 메시지를 준다.
 */
export async function deleteCategory(db: Db, id: number) {
  const [child] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.parentId, id))
    .limit(1);

  if (child) {
    throw ApiError.conflict(
      '하위 카테고리가 있어 삭제할 수 없습니다. 하위를 먼저 옮기거나 지워주세요.',
    );
  }

  // 글은 ON DELETE SET NULL 이라 지워지지 않고 미분류가 된다.
  const result = await db
    .delete(categories)
    .where(eq(categories.id, id))
    .returning({ id: categories.id });
  if (result.length === 0) throw ApiError.notFound('카테고리를 찾을 수 없습니다.');
}

// ---------------------------------------------------------------------------
// 태그 / 시리즈
// ---------------------------------------------------------------------------

export async function listTagsWithCounts(db: Db) {
  return db
    .select({
      id: tags.id,
      slug: tags.slug,
      name: tags.name,
      description: tags.description,
      postCount: count(posts.id),
    })
    .from(tags)
    .leftJoin(postTags, eq(postTags.tagId, tags.id))
    .leftJoin(
      posts,
      and(eq(posts.id, postTags.postId), eq(posts.status, 'published'), isNull(posts.deletedAt)),
    )
    .groupBy(tags.id)
    .orderBy(sql`count(${posts.id}) desc`, asc(tags.name));
}

export async function getTagBySlug(db: Db, slug: string) {
  const [row] = await db.select().from(tags).where(eq(tags.slug, slug)).limit(1);
  return row ?? null;
}

export async function listSeries(db: Db) {
  return db.select().from(series).orderBy(asc(series.title));
}

export async function getSeriesBySlug(db: Db, slug: string) {
  const [row] = await db.select().from(series).where(eq(series.slug, slug)).limit(1);
  return row ?? null;
}
