export const POST_STATUSES = ['draft', 'scheduled', 'published', 'archived'] as const;
export const COMMENT_STATUSES = ['pending', 'approved', 'spam', 'deleted'] as const;

export type PostStatus = (typeof POST_STATUSES)[number];
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  draft: '초안',
  scheduled: '예약',
  published: '발행됨',
  archived: '보관',
};

export const PROTECTED_LISTINGS = ['title', 'masked', 'hidden'] as const;
export type ProtectedListing = (typeof PROTECTED_LISTINGS)[number];

export const PROTECTED_LISTING_LABEL: Record<ProtectedListing, string> = {
  title: '제목만 보이기',
  masked: '제목도 가리기',
  hidden: '목록에서 숨기기',
};

export const PROTECTED_LISTING_HINT: Record<ProtectedListing, string> = {
  title: '목록에 제목과 자물쇠가 보이고 요약·표지·태그는 가립니다.',
  masked: "목록에 '비밀글' 이라고만 나오고 제목·카테고리·태그를 가립니다.",
  hidden: '목록·카테고리·태그 어디에도 안 나옵니다. 링크를 아는 사람만 들어옵니다.',
};

/*
 * pending 은 승인제 시절의 상태다. 댓글이 바로 공개되도록 바뀐 뒤로는
 * 어떤 화면도 이 상태를 만들지 않는다. DB 에서 지우지는 않고 화면에서만 뺀다.
 */
export const COMMENT_STATUS_LABEL: Record<CommentStatus, string> = {
  pending: '대기',
  approved: '공개',
  spam: '스팸',
  deleted: '삭제',
};

/** 모더레이션 화면의 탭. */
export const MODERATION_STATUSES = ['approved', 'spam', 'deleted'] as const;

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

export interface Tag {
  id: number;
  slug: string;
  name: string;
  description: string | null;
}

export interface Series {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
}

export interface PostListItem {
  id: number;
  slug: string;
  title: string;
  status: PostStatus;
  publishedAt: number | null;
  updatedAt: number;
  commentCount: number;
  likeCount: number;
  viewCount: number;
  categoryName: string | null;
  hasPassword: boolean;
  protectedListing: ProtectedListing;
}

export interface PostDetail {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  content: string;
  contentHtml: string | null;
  coverImageUrl: string | null;
  categoryId: number | null;
  seriesId: number | null;
  seriesOrder: number | null;
  status: PostStatus;
  publishedAt: number | null;
  readingMinutes: number;
  wordCount: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  allowComments: boolean;
  isPinned: boolean;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  /** 비밀글인지. 해시 자체는 서버가 내려주지 않는다. */
  hasPassword: boolean;
  protectedListing: ProtectedListing;
  tags: Tag[];
}

export interface ModerationComment {
  id: number;
  postId: number;
  postSlug: string;
  postTitle: string;
  parentId: number | null;
  authorName: string;
  authorEmail: string | null;
  authorWebsite: string | null;
  body: string;
  status: CommentStatus;
  /** 비밀 댓글. 공개 화면에는 잠금 표시만 나간다. 여기서만 본문을 볼 수 있다. */
  isSecret: boolean;
  /** 관리자가 단 답글. */
  isOwner: boolean;
  createdAt: number;
}

export interface MediaItem {
  id: number;
  objectKey: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  alt: string | null;
  createdAt: number;
}

export interface SitePage {
  id: number;
  slug: string;
  title: string;
  content: string;
  status: PostStatus;
  showInNav: boolean;
  navLabel: string | null;
  sortOrder: number;
  metaDescription: string | null;
}

export interface Project {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  description: string;
  thumbnailUrl: string | null;
  repoUrl: string | null;
  demoUrl: string | null;
  techStack: string[];
  role: string | null;
  startedOn: string | null;
  endedOn: string | null;
  isFeatured: boolean;
  isPublished: boolean;
  sortOrder: number;
}

export interface Stats {
  posts: Record<PostStatus, number>;
  totals: { views: number; likes: number; comments: number };
  pendingComments: number;
  viewsByDay: { day: string; views: number }[];
  topPosts: {
    slug: string;
    title: string;
    viewCount: number;
    likeCount: number;
    commentCount: number;
  }[];
}

export interface PageMeta {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}
