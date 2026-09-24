/**
 * 사이트맵·RSS 가 쓰는 자료 모으기.
 *
 * 한 군데가 잠깐 막혔다고 피드 전체를 500 으로 떨어뜨리지 않는다.
 * 다만 모든 실패를 눈감아 주지는 않는다 — 어디를 봐주고 어디를 봐주지 않는지에
 * 기준이 있다 (아래 hard/soft 참고).
 */

/**
 * 없어도 되는 자료. 실패하면 로그만 남기고 빈 값으로 간다.
 *
 * 카테고리·태그 목록이 잠깐 안 나온다고 글 주소까지 통째로 빠지는 편이
 * 훨씬 나쁘다. 색인에서 며칠 빠지느니 분류 주소 몇 개가 잠깐 빠지는 게 낫다.
 */
async function soft<T>(what: string, promise: Promise<{ data: T }>, fallback: T): Promise<T> {
  try {
    return (await promise).data ?? fallback;
  } catch (error) {
    console.error(`feed: ${what} 를 불러오지 못해 건너뜁니다`, error);
    return fallback;
  }
}

/**
 * 빠지면 안 되는 자료. 실패하면 그대로 던져 500 이 나가게 둔다.
 *
 * 글이 하나도 없는 사이트맵을 200 으로 내보내면 검색엔진은 그것을 "지금이
 * 정답" 으로 받아들인다. 500 은 "나중에 다시 오라" 는 뜻이라, 검색엔진이
 * 직전에 읽은 사이트맵을 그대로 들고 있는다.
 */
async function hard<T>(promise: Promise<{ data: T }>, fallback: T): Promise<T> {
  return (await promise).data ?? fallback;
}

export interface FeedApi {
  posts: { feed(): Promise<{ data: FeedPost[] }> };
  categories: { tree(): Promise<{ data: FeedCategory[] }> };
  tags: { list(): Promise<{ data: { slug: string }[] }> };
  pages: { feed(): Promise<{ data: FeedPage[] }> };
  projects: { list(): Promise<{ data: FeedProject[] }> };
  site: { settings(): Promise<{ data: Record<string, unknown> }> };
}

export interface FeedPost {
  slug: string;
  title: string;
  summary: string | null;
  publishedAt: number | null;
  updatedAt: number;
}
export interface FeedCategory {
  path: string;
  children: FeedCategory[];
}
export interface FeedPage {
  slug: string;
  updatedAt: number;
}
export interface FeedProject {
  slug: string;
  isFeatured: boolean;
}

export interface SitemapSources {
  posts: FeedPost[];
  categories: FeedCategory[];
  tags: { slug: string }[];
  pages: FeedPage[];
  projects: FeedProject[];
}

/** 사이트맵 재료. 글만 필수고 나머지는 없으면 없는 대로 간다. */
export async function collectSitemapSources(api: FeedApi): Promise<SitemapSources> {
  const [posts, categories, tags, pages, projects] = await Promise.all([
    hard(api.posts.feed(), [] as FeedPost[]),
    soft('카테고리', api.categories.tree(), [] as FeedCategory[]),
    soft('태그', api.tags.list(), [] as { slug: string }[]),
    soft('페이지', api.pages.feed(), [] as FeedPage[]),
    soft('프로젝트', api.projects.list(), [] as FeedProject[]),
  ]);

  return { posts, categories, tags, pages, projects };
}

export interface RssSources {
  posts: FeedPost[];
  settings: Record<string, unknown>;
}

/** RSS 재료. 제목·소개가 없으면 기본값으로 나가면 되지만 글은 필수다. */
export async function collectRssSources(api: FeedApi): Promise<RssSources> {
  const [posts, settings] = await Promise.all([
    hard(api.posts.feed(), [] as FeedPost[]),
    soft('사이트 설정', api.site.settings(), {} as Record<string, unknown>),
  ]);

  return { posts, settings };
}
