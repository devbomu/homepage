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

export const COMMENT_STATUS_LABEL: Record<CommentStatus, string> = {
  pending: '대기',
  approved: '승인',
  spam: '스팸',
  deleted: '삭제',
};

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
