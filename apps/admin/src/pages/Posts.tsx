import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { adminApi } from '../lib/api';
import { POST_STATUSES, POST_STATUS_LABEL, type PostStatus } from '../lib/types';
import { Card, EmptyState, ErrorNotice, formatDate, Loading, PageHeader } from '../components/ui';

const STATUS_BADGE: Record<PostStatus, string> = {
  draft: 'badge-ghost',
  scheduled: 'badge-warning',
  published: 'badge-success',
  archived: 'badge-neutral',
};

export default function Posts() {
  const [status, setStatus] = useState<PostStatus | ''>('');
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['posts', status],
    queryFn: () =>
      adminApi.posts.list({ status: status || undefined, limit: 50 }).then((r) => r.data),
  });

  const remove = useMutation({
    mutationFn: (id: number) => adminApi.posts.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  return (
    <>
      <PageHeader
        title="글"
        actions={
          <Link to="/posts/new" className="btn btn-primary btn-sm">
            새 글
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          className={`btn btn-sm ${status === '' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setStatus('')}
        >
          전체
        </button>
        {POST_STATUSES.map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setStatus(s)}
          >
            {POST_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <ErrorNotice error={error ?? remove.error} />

      {isLoading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <EmptyState
          message="글이 없습니다."
          action={
            <Link to="/posts/new" className="btn btn-primary btn-sm">
              첫 글 쓰기
            </Link>
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>제목</th>
                <th className="w-24">상태</th>
                <th className="w-32">카테고리</th>
                <th className="w-40">수정</th>
                <th className="w-28 text-right">지표</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((post) => (
                <tr key={post.id} className="hover">
                  <td>
                    <Link to={`/posts/${post.id}`} className="link link-hover font-medium">
                      {post.title}
                    </Link>
                    <p className="text-base-content/40 truncate text-xs">{post.slug}</p>
                  </td>
                  <td>
                    <span className={`badge badge-sm ${STATUS_BADGE[post.status]}`}>
                      {POST_STATUS_LABEL[post.status]}
                    </span>
                  </td>
                  <td className="text-sm">{post.categoryName ?? '—'}</td>
                  <td className="text-base-content/60 text-xs">{formatDate(post.updatedAt)}</td>
                  <td className="text-base-content/60 text-right text-xs">
                    {post.viewCount} · ♥{post.likeCount} · 💬{post.commentCount}
                  </td>
                  <td className="text-right">
                    <button
                      className="btn btn-ghost btn-xs text-error"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (
                          confirm(`"${post.title}" 을(를) 삭제할까요?\n댓글과 좋아요는 남습니다.`)
                        ) {
                          remove.mutate(post.id);
                        }
                      }}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
