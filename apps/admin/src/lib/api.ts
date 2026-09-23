/**
 * 관리자 API 클라이언트.
 *
 * 항상 같은 오리진(/api/...)으로 요청한다. 관리자 Worker 가 이를 API 로 넘기면서
 * Cloudflare Access 가 주입한 JWT 헤더를 함께 전달한다 (worker/index.ts 참고).
 * 따라서 이 코드에는 토큰도, 자격증명 처리도 없다.
 */
import type { PageMeta } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Envelope<T> {
  data?: T;
  meta?: PageMeta;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

async function request<T>(path: string, init?: RequestInit): Promise<{ data: T; meta?: PageMeta }> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });

  if (response.status === 204) return { data: undefined as T };

  const body = (await response.json().catch(() => null)) as Envelope<T> | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'unknown',
      body?.error?.message ?? `요청 실패 (${response.status})`,
      body?.error?.fields,
    );
  }
  return { data: body?.data as T, meta: body?.meta };
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const adminApi = {
  me: () => request<{ email: string; commonName: string }>('/v1/admin/me'),
  stats: () => request<import('./types').Stats>('/v1/admin/stats'),

  posts: {
    list: (params: { status?: string; cursor?: string; limit?: number } = {}) => {
      const query = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (v) query.set(k, String(v));
      return request<import('./types').PostListItem[]>(`/v1/admin/posts?${query}`);
    },
    get: (id: number) => request<import('./types').PostDetail>(`/v1/admin/posts/${id}`),
    create: (body: unknown) =>
      request<{ id: number; slug: string }>('/v1/admin/posts', { method: 'POST', ...json(body) }),
    update: (id: number, body: unknown) =>
      request<import('./types').PostDetail>(`/v1/admin/posts/${id}`, {
        method: 'PATCH',
        ...json(body),
      }),
    remove: (id: number) => request<void>(`/v1/admin/posts/${id}`, { method: 'DELETE' }),
    preview: (id: number, content: string) =>
      request<{ contentHtml: string }>(`/v1/admin/posts/${id}/preview`, {
        method: 'POST',
        ...json({ content }),
      }),
  },

  categories: {
    tree: () => request<import('./types').CategoryNode[]>('/v1/admin/categories'),
    create: (body: unknown) =>
      request<unknown>('/v1/admin/categories', { method: 'POST', ...json(body) }),
    update: (id: number, body: unknown) =>
      request<unknown>(`/v1/admin/categories/${id}`, { method: 'PATCH', ...json(body) }),
    remove: (id: number) => request<void>(`/v1/admin/categories/${id}`, { method: 'DELETE' }),
  },

  tags: {
    list: () => request<import('./types').Tag[]>('/v1/admin/tags'),
    create: (body: unknown) =>
      request<import('./types').Tag>('/v1/admin/tags', { method: 'POST', ...json(body) }),
    update: (id: number, body: unknown) =>
      request<import('./types').Tag>(`/v1/admin/tags/${id}`, { method: 'PATCH', ...json(body) }),
    remove: (id: number) => request<void>(`/v1/admin/tags/${id}`, { method: 'DELETE' }),
  },

  series: {
    list: () => request<import('./types').Series[]>('/v1/admin/series'),
    create: (body: unknown) =>
      request<import('./types').Series>('/v1/admin/series', { method: 'POST', ...json(body) }),
    update: (id: number, body: unknown) =>
      request<import('./types').Series>(`/v1/admin/series/${id}`, {
        method: 'PATCH',
        ...json(body),
      }),
    remove: (id: number) => request<void>(`/v1/admin/series/${id}`, { method: 'DELETE' }),
  },

  comments: {
    list: (params: { status?: string; cursor?: string } = {}) => {
      const query = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (v) query.set(k, String(v));
      return request<import('./types').ModerationComment[]>(`/v1/admin/comments?${query}`);
    },
    pendingCount: () => request<{ count: number }>('/v1/admin/comments/pending-count'),
    setStatus: (id: number, status: string) =>
      request<unknown>(`/v1/admin/comments/${id}`, { method: 'PATCH', ...json({ status }) }),
    remove: (id: number) => request<void>(`/v1/admin/comments/${id}`, { method: 'DELETE' }),
  },

  media: {
    list: () => request<import('./types').MediaItem[]>('/v1/admin/media'),
    upload: (file: File, alt?: string) => {
      const form = new FormData();
      form.append('file', file);
      if (alt) form.append('alt', alt);
      return request<import('./types').MediaItem>('/v1/admin/media', {
        method: 'POST',
        body: form,
      });
    },
    remove: (id: number) => request<void>(`/v1/admin/media/${id}`, { method: 'DELETE' }),
  },

  pages: {
    list: () => request<import('./types').SitePage[]>('/v1/admin/pages'),
    get: (id: number) => request<import('./types').SitePage>(`/v1/admin/pages/${id}`),
    create: (body: unknown) =>
      request<import('./types').SitePage>('/v1/admin/pages', { method: 'POST', ...json(body) }),
    update: (id: number, body: unknown) =>
      request<import('./types').SitePage>(`/v1/admin/pages/${id}`, {
        method: 'PATCH',
        ...json(body),
      }),
    remove: (id: number) => request<void>(`/v1/admin/pages/${id}`, { method: 'DELETE' }),
  },

  projects: {
    list: () => request<import('./types').Project[]>('/v1/admin/projects'),
    create: (body: unknown) =>
      request<import('./types').Project>('/v1/admin/projects', { method: 'POST', ...json(body) }),
    update: (id: number, body: unknown) =>
      request<import('./types').Project>(`/v1/admin/projects/${id}`, {
        method: 'PATCH',
        ...json(body),
      }),
    remove: (id: number) => request<void>(`/v1/admin/projects/${id}`, { method: 'DELETE' }),
  },

  settings: {
    get: () => request<Record<string, unknown>>('/v1/admin/settings'),
    update: (body: Record<string, unknown>) =>
      request<unknown>('/v1/admin/settings', { method: 'PUT', ...json(body) }),
  },
};
