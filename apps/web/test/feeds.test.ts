import { describe, expect, it, vi } from 'vitest';

import {
  collectRssSources,
  collectSitemapSources,
  type FeedApi,
  type FeedPost,
} from '../src/lib/feeds';

const POST: FeedPost = {
  slug: 'hello',
  title: '첫 글',
  summary: '요약',
  publishedAt: 1700000000,
  updatedAt: 1700000000,
};

/** 각 부분을 성공/실패로 지정할 수 있는 가짜 API. */
function fakeApi(failing: string[] = []): FeedApi {
  const give =
    <T>(name: string, value: T) =>
    () =>
      failing.includes(name)
        ? Promise.reject(new Error(`${name} 실패`))
        : Promise.resolve({ data: value });

  return {
    posts: { feed: give('posts', [POST]) },
    categories: { tree: give('categories', [{ path: 'dev', children: [] }]) },
    tags: { list: give('tags', [{ slug: 'astro' }]) },
    pages: { feed: give('pages', [{ slug: 'about', updatedAt: 1700000000 }]) },
    projects: { list: give('projects', [{ slug: 'proj', isFeatured: true }]) },
    site: { settings: give('settings', { 'site.title': '내 블로그' }) },
  };
}

describe('collectSitemapSources', () => {
  it('다 잘 되면 전부 담는다', async () => {
    const sources = await collectSitemapSources(fakeApi());
    expect(sources.posts).toHaveLength(1);
    expect(sources.categories).toHaveLength(1);
    expect(sources.tags).toHaveLength(1);
    expect(sources.pages).toHaveLength(1);
    expect(sources.projects).toHaveLength(1);
  });

  it.each(['categories', 'tags', 'pages', 'projects'])(
    '%s 가 실패해도 나머지로 내보낸다',
    async (broken) => {
      const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
      const sources = await collectSitemapSources(fakeApi([broken]));

      // 글은 그대로 남아야 한다. 색인에서 빠지면 안 되는 것이 이것이다.
      expect(sources.posts).toHaveLength(1);
      expect(sources[broken as 'categories']).toHaveLength(0);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    },
  );

  it('여러 개가 한꺼번에 실패해도 글은 살아 있다', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sources = await collectSitemapSources(fakeApi(['categories', 'tags', 'projects']));
    expect(sources.posts).toHaveLength(1);
    expect(sources.categories).toHaveLength(0);
    expect(sources.tags).toHaveLength(0);
    expect(sources.projects).toHaveLength(0);
    expect(sources.pages).toHaveLength(1);
    warn.mockRestore();
  });

  /*
   * 글이 하나도 없는 사이트맵을 200 으로 내보내면 검색엔진은 그것을 "지금이
   * 정답" 으로 받아들인다. 던져서 500 이 나가야 직전 사이트맵이 유지된다.
   */
  it('글 목록이 실패하면 던진다', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(collectSitemapSources(fakeApi(['posts']))).rejects.toThrow('posts 실패');
    warn.mockRestore();
  });
});

describe('collectRssSources', () => {
  it('설정이 실패해도 글은 내보낸다', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sources = await collectRssSources(fakeApi(['settings']));
    expect(sources.posts).toHaveLength(1);
    expect(sources.settings).toEqual({});
    warn.mockRestore();
  });

  it('글 목록이 실패하면 던진다', async () => {
    await expect(collectRssSources(fakeApi(['posts']))).rejects.toThrow('posts 실패');
  });
});
