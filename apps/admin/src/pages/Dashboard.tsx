import { useQuery } from '@tanstack/react-query';

import { adminApi } from '../lib/api';
import { POST_STATUS_LABEL, type PostStatus } from '../lib/types';
import { Card, ErrorNotice, Loading, PageHeader } from '../components/ui';

export default function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['stats'],
    queryFn: () => adminApi.stats().then((r) => r.data),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorNotice error={error} />;
  if (!data) return null;

  const maxViews = Math.max(1, ...data.viewsByDay.map((d) => d.views));

  return (
    <>
      <PageHeader title="대시보드" description="사이트 현황 요약" />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(POST_STATUS_LABEL) as PostStatus[]).map((status) => (
          <Card key={status}>
            <p className="text-base-content/60 text-xs">{POST_STATUS_LABEL[status]}</p>
            <p className="mt-1 text-2xl font-bold">{data.posts[status] ?? 0}</p>
          </Card>
        ))}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          { label: '총 조회', value: data.totals.views },
          { label: '총 좋아요', value: data.totals.likes },
          { label: '총 댓글', value: data.totals.comments },
        ].map((item) => (
          <Card key={item.label}>
            <p className="text-base-content/60 text-xs">{item.label}</p>
            <p className="mt-1 text-2xl font-bold">{item.value.toLocaleString('ko-KR')}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-semibold">최근 30일 조회수</h2>
          {data.viewsByDay.length === 0 ? (
            <p className="text-base-content/50 py-8 text-center text-sm">아직 기록이 없습니다.</p>
          ) : (
            /* 라이브러리 없이 막대만 그린다. 이 정도 정보에 차트 의존성을 더할 이유가 없다. */
            <div className="flex h-32 items-end gap-0.5" role="img" aria-label="일별 조회수 추이">
              {data.viewsByDay.map((day) => (
                <div
                  key={day.day}
                  className="bg-primary/70 hover:bg-primary min-w-0 flex-1 rounded-t transition-colors"
                  style={{ height: `${Math.max(4, (day.views / maxViews) * 100)}%` }}
                  title={`${day.day} · ${day.views}회`}
                />
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold">조회 많은 글</h2>
          {data.topPosts.length === 0 ? (
            <p className="text-base-content/50 py-8 text-center text-sm">
              아직 발행한 글이 없습니다.
            </p>
          ) : (
            <ol className="space-y-2 text-sm">
              {data.topPosts.map((post, index) => (
                <li key={post.slug} className="flex items-baseline gap-2">
                  <span className="text-base-content/40 w-5 shrink-0 text-right text-xs">
                    {index + 1}
                  </span>
                  <a
                    href={`https://www.namsu.kim/blog/${encodeURIComponent(post.slug)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="link link-hover flex-1 truncate"
                  >
                    {post.title}
                  </a>
                  <span className="text-base-content/50 shrink-0 text-xs">
                    {post.viewCount.toLocaleString('ko-KR')}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
