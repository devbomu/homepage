/**
 * API 클라이언트.
 *
 * 공개 사이트는 api.namsu.kim 에서만 데이터를 읽는다. D1 에 직접 붙지 않는다.
 * 그래야 관리자에서 글을 고치면 재배포 없이 바로 반영된다.
 */

export interface PostTag {
  slug: string;
  name: string;
}

export interface PostSummary {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  coverImageUrl: string | null;
  publishedAt: number | null;
  readingMinutes: number;
  wordCount: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  isPinned: boolean;
  category: { slug: string; name: string; path: string } | null;
  series: { slug: string; title: string; order: number | null } | null;
  tags: PostTag[];
  /** 비밀번호를 넣어야 본문이 열리는 글. */
  isProtected: boolean;
  /** 제목까지 가리기로 한 비밀글. 이때 title 은 빈 문자열이다. */
  isMasked: boolean;
}

export interface PostDetail extends PostSummary {
  contentHtml: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  allowComments: boolean;
  updatedAt: number;
  breadcrumb: { slug: string; name: string; path: string }[];
  related: PostSummary[];
  previous: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
}

export interface CommentNode {
  id: number;
  parentId: number | null;
  authorName: string;
  authorWebsite: string | null;
  body: string;
  isOwner: boolean;
  /** 비밀 댓글이면 authorName 과 body 가 비어 있다. 잠금 표시만 렌더한다. */
  isSecret: boolean;
  createdAt: number;
  replies: CommentNode[];
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

export interface TagWithCount extends PostTag {
  id: number;
  description: string | null;
  postCount: number;
}

export interface PageContent {
  slug: string;
  title: string;
  contentHtml: string | null;
  metaDescription: string | null;
  publishedAt: number | null;
  updatedAt: number;
}

export interface ProjectDetail extends Project {
  description: string;
  descriptionHtml: string | null;
  updatedAt: number;
}

export interface Project {
  slug: string;
  title: string;
  summary: string | null;
  thumbnailUrl: string | null;
  repoUrl: string | null;
  demoUrl: string | null;
  techStack: string[];
  role: string | null;
  startedOn: string | null;
  endedOn: string | null;
  isFeatured: boolean;
}

export interface PageMeta {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface SiteSettings {
  'site.title'?: string;
  'site.description'?: string;
  'site.author'?: string;
  'site.locale'?: string;
  'site.social'?: Record<string, string>;
  /** 브라우저 탭 아이콘. 비우면 저장소의 기본 파비콘을 쓴다. */
  'site.faviconUrl'?: string;
  /** 공유 카드 기본 이미지. 글에 자체 이미지가 없을 때 쓰인다. */
  'site.ogImageUrl'?: string;
  /** Cloudflare Web Analytics 비콘 토큰. 비어 있으면 스크립트를 넣지 않는다. */
  'site.cfBeaconToken'?: string;
  /** GA4 측정 ID (G-XXXXXXXXXX). 비어 있으면 스크립트를 넣지 않는다. */
  'site.gaMeasurementId'?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNotFound() {
    return this.status === 404;
  }
}

function baseUrl(): string {
  // Workers 런타임에서는 import.meta.env 로 주입된 값을 쓴다.
  return (import.meta.env.PUBLIC_API_URL as string | undefined) ?? 'http://localhost:8787';
}

async function request<T>(path: string, init?: RequestInit): Promise<{ data: T; meta?: PageMeta }> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  });

  const body = (await response.json().catch(() => null)) as {
    data?: T;
    meta?: PageMeta;
    error?: { code: string; message: string };
  } | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'unknown',
      body?.error?.message ?? `API 요청 실패 (${response.status})`,
    );
  }
  return { data: body?.data as T, meta: body?.meta };
}

/** 없으면 null. 목록 페이지 하나가 실패해도 화면 전체가 죽지 않게 한다. */
async function optional<T>(promise: Promise<{ data: T }>): Promise<T | null> {
  try {
    return (await promise).data;
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) return null;
    throw error;
  }
}

export const api = {
  posts: {
    list(
      params: {
        limit?: number;
        cursor?: string;
        category?: string;
        tag?: string;
        series?: string;
      } = {},
    ) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value != null && value !== '') query.set(key, String(value));
      }
      const suffix = query.size > 0 ? `?${query}` : '';
      return request<PostSummary[]>(`/v1/posts${suffix}`);
    },

    pinned() {
      return request<PostSummary[]>('/v1/posts/pinned');
    },

    get(slug: string) {
      return optional(request<PostDetail>(`/v1/posts/${encodeURIComponent(slug)}`));
    },

    search(query: string, limit = 20) {
      return request<PostSummary[]>(
        `/v1/posts/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      );
    },

    comments(slug: string) {
      return request<{ allowComments: boolean; comments: CommentNode[] }>(
        `/v1/posts/${encodeURIComponent(slug)}/comments`,
      );
    },

    feed() {
      return request<
        {
          slug: string;
          title: string;
          summary: string | null;
          publishedAt: number | null;
          updatedAt: number;
        }[]
      >('/v1/feed/posts');
    },
  },

  categories: {
    tree() {
      return request<CategoryNode[]>('/v1/categories');
    },
    get(path: string) {
      return optional(
        request<CategoryNode & { breadcrumb: { slug: string; name: string; path: string }[] }>(
          `/v1/categories/${path.split('/').map(encodeURIComponent).join('/')}`,
        ),
      );
    },
  },

  tags: {
    list() {
      return request<TagWithCount[]>('/v1/tags');
    },
  },

  pages: {
    /** 사이트맵용. 메뉴 노출 여부와 무관하게 공개된 페이지 전부. */
    feed() {
      return request<
        { slug: string; title: string; publishedAt: number | null; updatedAt: number }[]
      >('/v1/feed/pages');
    },

    get(slug: string) {
      return optional(request<PageContent>(`/v1/pages/${encodeURIComponent(slug)}`));
    },
  },

  projects: {
    list() {
      return request<Project[]>('/v1/projects');
    },
    get(slug: string) {
      return optional(request<ProjectDetail>(`/v1/projects/${encodeURIComponent(slug)}`));
    },
  },

  site: {
    settings() {
      return request<SiteSettings>('/v1/settings');
    },
    nav() {
      return request<{ slug: string; label: string }[]>('/v1/nav');
    },
  },
};
