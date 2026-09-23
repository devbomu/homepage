import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { adminApi } from '../lib/api';
import {
  COMMENT_STATUS_LABEL,
  MODERATION_STATUSES,
  type CommentStatus,
  type ModerationComment,
} from '../lib/types';
import { Card, EmptyState, ErrorNotice, formatDate, Loading, PageHeader } from '../components/ui';

const BADGE: Record<CommentStatus, string> = {
  pending: 'badge-ghost',
  approved: 'badge-success',
  spam: 'badge-error',
  deleted: 'badge-ghost',
};

export default function Comments() {
  // 댓글은 바로 공개되므로 따로 걸러낼 큐가 없다.
  // 전체를 먼저 보여주고, 숨김·스팸 처리와 삭제를 여기서 한다.
  const [status, setStatus] = useState<CommentStatus | ''>('');
  // 답글 입력창은 한 번에 하나만 연다. 값은 댓글 id 다.
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyBody, setReplyBody] = useState('');
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

  const reply = useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) => adminApi.comments.reply(id, body),
    onSuccess: () => {
      setReplyTo(null);
      setReplyBody('');
      invalidate();
    },
  });

  return (
    <>
      <PageHeader
        title="댓글"
        description="댓글은 올라오는 즉시 공개됩니다. 문제가 되는 것만 스팸 처리하거나 삭제하세요."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          className={`btn btn-sm ${status === '' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setStatus('')}
        >
          전체
        </button>
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

      <ErrorNotice error={error ?? setStatusMutation.error ?? remove.error ?? reply.error} />

      {isLoading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <EmptyState
          message={status === 'pending' ? '숨겨둔 댓글이 없습니다.' : '댓글이 없습니다.'}
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
                  {comment.isOwner && <span className="badge badge-primary badge-sm">내 답글</span>}
                  {comment.isSecret && (
                    <span className="badge badge-neutral badge-sm gap-1">
                      <span aria-hidden="true">🔒</span> 비밀
                    </span>
                  )}
                </div>

                {/*
                  비밀 댓글의 본문은 이 화면에만 나온다.
                  공개 API 는 authorName 과 body 를 빈 문자열로 비워 내려보낸다.
                */}
                <p className="text-sm whitespace-pre-wrap">{comment.body}</p>

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
                      다시 공개
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
                  {/*
                    답글은 공개 상태인 댓글에만 달 수 있다. 숨겨둔 댓글에 답글을 달면
                    부모가 공개 목록에 없어서 답글만 최상위로 떠오른다.
                  */}
                  {comment.status === 'approved' && (
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        setReplyTo(replyTo === comment.id ? null : comment.id);
                        setReplyBody('');
                      }}
                    >
                      답글
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

                {replyTo === comment.id && (
                  <ReplyBox
                    comment={comment}
                    value={replyBody}
                    onChange={setReplyBody}
                    pending={reply.isPending}
                    onCancel={() => setReplyTo(null)}
                    onSubmit={() => reply.mutate({ id: comment.id, body: replyBody.trim() })}
                  />
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ReplyBox({
  comment,
  value,
  onChange,
  pending,
  onCancel,
  onSubmit,
}: {
  comment: ModerationComment;
  value: string;
  onChange: (next: string) => void;
  pending: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const inputId = `reply-${comment.id}`;

  return (
    <div className="border-base-300 space-y-2 border-t pt-3">
      <label htmlFor={inputId} className="label-text text-sm">
        답글 — 바로 공개됩니다.
      </label>
      {/*
        비밀 댓글의 답글은 서버가 강제로 비밀로 만든다. 선택지로 두지 않는 이유는
        답글 한 줄만으로도 원래 질문이 짐작되기 때문이다.
      */}
      {comment.isSecret && (
        <p className="text-base-content/60 text-xs">
          🔒 비밀 댓글의 답글이라 이 답글도 비밀로 등록됩니다. 작성자와 관리자만 봅니다.
        </p>
      )}
      <textarea
        id={inputId}
        className="textarea textarea-bordered w-full text-sm"
        rows={3}
        maxLength={5000}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost btn-xs" onClick={onCancel} disabled={pending}>
          취소
        </button>
        <button
          className="btn btn-primary btn-xs"
          onClick={onSubmit}
          disabled={pending || value.trim().length === 0}
        >
          답글 등록
        </button>
      </div>
    </div>
  );
}
