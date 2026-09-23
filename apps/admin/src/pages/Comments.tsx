import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { adminApi } from '../lib/api';
import { COMMENT_STATUSES, COMMENT_STATUS_LABEL, type CommentStatus } from '../lib/types';
import { Card, EmptyState, ErrorNotice, formatDate, Loading, PageHeader } from '../components/ui';

const BADGE: Record<CommentStatus, string> = {
  pending: 'badge-warning',
  approved: 'badge-success',
  spam: 'badge-error',
  deleted: 'badge-ghost',
};

export default function Comments() {
  // 기본은 대기 큐다. 관리자가 여기서 할 일이 그것이기 때문이다.
  const [status, setStatus] = useState<CommentStatus | ''>('pending');
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['comments', status],
    queryFn: () => adminApi.comments.list({ status: status || undefined }).then((r) => r.data),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['comments'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  const setStatusMutation = useMutation({
    mutationFn: ({ id, next }: { id: number; next: CommentStatus }) =>
      adminApi.comments.setStatus(id, next),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: number) => adminApi.comments.remove(id),
    onSuccess: invalidate,
  });

  return (
    <>
      <PageHeader title="댓글" description="승인해야 공개 사이트에 보입니다." />

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          className={`btn btn-sm ${status === '' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setStatus('')}
        >
          전체
        </button>
        {COMMENT_STATUSES.map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setStatus(s)}
          >
            {COMMENT_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <ErrorNotice error={error ?? setStatusMutation.error ?? remove.error} />

      {isLoading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <EmptyState
          message={status === 'pending' ? '승인 대기 중인 댓글이 없습니다.' : '댓글이 없습니다.'}
        />
      ) : (
        <ul className="space-y-3">
          {data.map((comment) => (
            <li key={comment.id}>
              <Card className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{comment.authorName}</span>
                  <span className={`badge badge-sm ${BADGE[comment.status]}`}>
                    {COMMENT_STATUS_LABEL[comment.status]}
                  </span>
                  <span className="text-base-content/50 text-xs">
                    {formatDate(comment.createdAt)}
                  </span>
                  {comment.parentId && <span className="badge badge-ghost badge-sm">답글</span>}
                </div>

                <p className="whitespace-pre-wrap text-sm">{comment.body}</p>

                <div className="text-base-content/50 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <a
                    href={`https://www.namsu.kim/blog/${encodeURIComponent(comment.postSlug)}#comments`}
                    target="_blank"
                    rel="noreferrer"
                    className="link link-hover"
                  >
                    {comment.postTitle} ↗
                  </a>
                  {/* 이메일은 여기서만 보인다. 공개 API 응답에는 포함되지 않는다. */}
                  {comment.authorEmail && <span>{comment.authorEmail}</span>}
                  {comment.authorWebsite && (
                    <span className="truncate">{comment.authorWebsite}</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {comment.status !== 'approved' && (
                    <button
                      className="btn btn-success btn-xs"
                      disabled={setStatusMutation.isPending}
                      onClick={() => setStatusMutation.mutate({ id: comment.id, next: 'approved' })}
                    >
                      승인
                    </button>
                  )}
                  {comment.status !== 'spam' && (
                    <button
                      className="btn btn-warning btn-xs"
                      disabled={setStatusMutation.isPending}
                      onClick={() => setStatusMutation.mutate({ id: comment.id, next: 'spam' })}
                    >
                      스팸
                    </button>
                  )}
                  {comment.status === 'approved' && (
                    <button
                      className="btn btn-ghost btn-xs"
                      disabled={setStatusMutation.isPending}
                      onClick={() => setStatusMutation.mutate({ id: comment.id, next: 'pending' })}
                    >
                      숨기기
                    </button>
                  )}
                  <button
                    className="btn btn-ghost btn-xs text-error ml-auto"
                    onClick={() => {
                      if (confirm('이 댓글을 삭제할까요?\n답글은 함께 사라지지 않습니다.'))
                        remove.mutate(comment.id);
                    }}
                  >
                    삭제
                  </button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
