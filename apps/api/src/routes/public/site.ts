import { createDb, pages, posts, projects, siteSettings } from '@namsu/db';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';

import type { AppEnv } from '../../env';
import { ApiError } from '../../lib/errors';
import { renderMarkdown } from '../../lib/markdown';
import { ok } from '../../lib/response';

export const publicSite = new Hono<AppEnv>();

/** GET /v1/settings — 사이트 제목·소개·소셜 링크 등. 관리자에서 편집한다. */
publicSite.get('/settings', async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.select().from(siteSettings);

  const settings: Record<string, unknown> = {};
  for (const row of rows) settings[row.key] = row.value;

  return ok(c, settings);
});

/** GET /v1/nav — 상단 네비게이션에 노출할 단독 페이지. */
publicSite.get('/nav', async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db
    .select({ slug: pages.slug, label: pages.navLabel, title: pages.title })
    .from(pages)
    .where(and(eq(pages.showInNav, true), eq(pages.status, 'published')))
    .orderBy(asc(pages.sortOrder), asc(pages.id));

  return ok(
    c,
    rows.map((row) => ({ slug: row.slug, label: row.label ?? row.title })),
  );
});

/** GET /v1/pages/:slug — /about, /now, /uses 같은 단독 페이지. */
publicSite.get('/pages/:slug', async (c) => {
  const db = createDb(c.env.DB);
  const [page] = await db
    .select({
      slug: pages.slug,
      title: pages.title,
      contentHtml: pages.contentHtml,
      content: pages.content,
      metaDescription: pages.metaDescription,
      publishedAt: pages.publishedAt,
      updatedAt: pages.updatedAt,
    })
    .from(pages)
    .where(and(eq(pages.slug, c.req.param('slug')), eq(pages.status, 'published')))
    .limit(1);

  if (!page) throw ApiError.notFound('페이지를 찾을 수 없습니다.');

  const { content, ...rest } = page;
  return ok(c, { ...rest, contentHtml: page.contentHtml ?? renderMarkdown(content) });
});

/** GET /v1/projects — 포트폴리오. 대표 프로젝트가 앞에 온다. */
publicSite.get('/projects', async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db
    .select({
      slug: projects.slug,
      title: projects.title,
      summary: projects.summary,
      thumbnailUrl: projects.thumbnailUrl,
      repoUrl: projects.repoUrl,
      demoUrl: projects.demoUrl,
      techStack: projects.techStack,
      role: projects.role,
      startedOn: projects.startedOn,
      endedOn: projects.endedOn,
      isFeatured: projects.isFeatured,
    })
    .from(projects)
    .where(eq(projects.isPublished, true))
    .orderBy(desc(projects.isFeatured), asc(projects.sortOrder), desc(projects.startedOn));

  return ok(c, rows);
});

/** GET /v1/projects/:slug */
publicSite.get('/projects/:slug', async (c) => {
  const db = createDb(c.env.DB);
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, c.req.param('slug')), eq(projects.isPublished, true)))
    .limit(1);

  if (!project) throw ApiError.notFound('프로젝트를 찾을 수 없습니다.');
  return ok(c, project);
});

/**
 * GET /v1/feed/posts
 * RSS 와 sitemap 은 www.namsu.kim 도메인에서 나가야 하므로 Astro 가 생성한다.
 * 여기서는 그 재료만 준다 (발행된 글 전체의 최소 필드).
 */
publicSite.get('/feed/posts', async (c) => {
  const db = createDb(c.env.DB);

  const rows = await db
    .select({
      slug: posts.slug,
      title: posts.title,
      summary: posts.summary,
      publishedAt: posts.publishedAt,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .where(and(eq(posts.status, 'published'), isNull(posts.deletedAt)))
    .orderBy(desc(posts.publishedAt))
    .limit(500);

  return ok(c, rows);
});
