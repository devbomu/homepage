import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { adminApi } from '../lib/api';
import { COMMENT_STATUS_LABEL, MODERATION_STATUSES, type CommentStatus } from '../lib/types';
import { Card, EmptyState, ErrorNotice, formatDate, Loading, PageHeader } from '../components/ui';

const BADGE: Record<CommentStatus, string> = {
  pending: 'badge-ghost',
  approved: 'badge-success',
  spam: 'badge-error',
  deleted: 'badge-ghost',
};

const EMPTY_MESSAGE: Record<CommentStatus, string> = {
  approved: '아직 남겨진 글이 없습니다.',
  spam: '스팸으로 분류한 글이 없습니다.',
  deleted: '삭제한 글이 없습니다.',
  pending: '글이 없습니다.',
};

/**
 * 방명록 모더레이션.
 *
 * 댓글 화면과 같은 규칙으로 움직인다 — 바로 공개되고, 문제가 되는 것만
 * 스팸 처리하거나 삭제한다. 답글이 없으므로 답글 상자도 없다.
 */
export default function Guestbook() {
  const [status, setStatus] = useState<CommentStatus>('approved');
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['guestbook', status],
    queryFn: () => adminApi.guestbook.list({ status }).then((r) => r.data),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['guestbook'] });

  const setStatusMutation = useMutation({
    mutationFn: ({ id, next }: { id: number; next: CommentStatus }) =>
      adminApi.guestbook.setStatus(id, next),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: number) => adminApi.guestbook.remove(id),
    onSuccess: invalidate,
  });

  const restore = useMutation({
    mutationFn: (id: number) => adminApi.guestbook.restore(id),
    onSuccess: invalidate,
  });

  return (
    <>
      <PageHeader
        title="방명록"
        description="남겨주신 글은 바로 공개됩니다. 문제가 되는 것만 스팸 처리하거나 삭제하세요."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {MODERATION_STATUSES.map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setStatus(s)}
          >
            {COMMENT_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <ErrorNotice error={error ?? setStatusMutation.error ?? remove.error ?? restore.error} />

      {isLoading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <EmptyState message={EMPTY_MESSAGE[status]} />
      ) : (
        <ul className="space-y-3">
          {data.map((entry) => (
            <li key={entry.id}>
              <Card className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{entry.authorName}</span>
                  <span className={`badge badge-sm ${BADGE[entry.status]}`}>
                    {COMMENT_STATUS_LABEL[entry.status]}
                  </span>
                  <span className="text-base-content/50 text-xs">
                    {formatDate(entry.createdAt)}
                  </span>
                </div>

                <p className="text-sm whitespace-pre-wrap">{entry.body}</p>

                <div className="text-base-content/50 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {/* 이메일은 여기서만 보인다. 공개 API 응답에는 포함되지 않는다. */}
                  {entry.authorEmail && <span>{entry.authorEmail}</span>}
                  {entry.authorWebsite && <span className="truncate">{entry.authorWebsite}</span>}
                </div>

                <div className="flex flex-wrap gap-2">
                  {entry.status === 'deleted' ? (
                    <button
                      className="btn btn-success btn-xs"
                      disabled={restore.isPending}
                      onClick={() => restore.mutate(entry.id)}
                    >
                      되살리기
                    </button>
                  ) : (
                    <>
                      {entry.status !== 'approved' && (
                        <button
                          className="btn btn-success btn-xs"
                          disabled={setStatusMutation.isPending}
                          onClick={() =>
                            setStatusMutation.mutate({ id: entry.id, next: 'approved' })
                          }
                        >
                          다시 공개
                        </button>
                      )}
                      {entry.status !== 'spam' && (
                        <button
                          className="btn btn-warning btn-xs"
                          disabled={setStatusMutation.isPending}
                          onClick={() => setStatusMutation.mutate({ id: entry.id, next: 'spam' })}
                        >
                          스팸
                        </button>
                      )}
                      <button
                        className="btn btn-ghost btn-xs text-error ml-auto"
                        onClick={() => {
                          if (confirm('이 방명록 글을 삭제할까요?')) remove.mutate(entry.id);
                        }}
                      >
                        삭제
                      </button>
                    </>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
