import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { adminApi } from '../lib/api';
import { POST_STATUSES, POST_STATUS_LABEL, type PostStatus, type SitePage } from '../lib/types';
import SlugField from '../components/SlugField';
import MarkdownEditor from '../components/MarkdownEditor';
import { Card, EmptyState, ErrorNotice, Field, Loading, PageHeader } from '../components/ui';

export default function SitePages() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SitePage | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['pages'],
    queryFn: () => adminApi.pages.list().then((r) => r.data),
  });

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['pages'] });
    setEditing(null);
    setCreating(false);
  };

  const remove = useMutation({
    mutationFn: (id: number) => adminApi.pages.remove(id),
    onSuccess: done,
  });

  if (isLoading) return <Loading />;

  return (
    <>
      <PageHeader
        title="페이지"
        description="/about, /now, /uses 처럼 글이 아닌 단독 페이지입니다."
        actions={
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setCreating(true);
              setEditing(null);
            }}
          >
            페이지 추가
          </button>
        }
      />

      <ErrorNotice error={error ?? remove.error} />

      {(creating || editing) && (
        <PageForm
          key={editing?.id ?? 'new'}
          page={editing}
          onDone={done}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {!data || data.length === 0 ? (
        <EmptyState message="페이지가 없습니다." />
      ) : (
        <Card className="p-0">
          <ul className="divide-base-300 divide-y">
            {data.map((page) => (
              <li key={page.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{page.title}</p>
                  <p className="text-base-content/40 font-mono text-xs">/{page.slug}</p>
                </div>
                {page.showInNav && <span className="badge badge-ghost badge-sm">메뉴</span>}
                <span
                  className={`badge badge-sm ${page.status === 'published' ? 'badge-success' : 'badge-ghost'}`}
                >
                  {POST_STATUS_LABEL[page.status]}
                </span>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => {
                    setEditing(page);
                    setCreating(false);
                  }}
                >
                  수정
                </button>
                <button
                  className="btn btn-ghost btn-xs text-error"
                  onClick={() => {
                    if (confirm(`"${page.title}" 페이지를 삭제할까요?`)) remove.mutate(page.id);
                  }}
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function PageForm({
  page,
  onDone,
  onCancel,
}: {
  page: SitePage | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(page?.title ?? '');
  const [slug, setSlug] = useState(page?.slug ?? '');
  const [content, setContent] = useState(page?.content ?? '');
  const [status, setStatus] = useState<PostStatus>(page?.status ?? 'draft');
  const [showInNav, setShowInNav] = useState(page?.showInNav ?? false);
  const [navLabel, setNavLabel] = useState(page?.navLabel ?? '');
  const [sortOrder, setSortOrder] = useState(page?.sortOrder ?? 0);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        slug: slug || undefined,
        content,
        status,
        showInNav,
        navLabel: navLabel || null,
        sortOrder,
      };
      return page ? adminApi.pages.update(page.id, body) : adminApi.pages.create(body);
    },
    onSuccess: onDone,
  });

  return (
    <Card className="mb-4 space-y-4">
      <h2 className="font-semibold">{page ? '페이지 수정' : '페이지 추가'}</h2>
      <ErrorNotice error={save.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="제목" required>
          <input
            className="input input-bordered input-sm w-full"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <SlugField value={slug} onChange={setSlug} source={title} />
      </div>

      <MarkdownEditor value={content} onChange={setContent} minHeight="min-h-64" />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="상태">
          <select
            className="select select-bordered select-sm w-full"
            value={status}
            onChange={(e) => setStatus(e.target.value as PostStatus)}
          >
            {POST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {POST_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="메뉴 표시 이름" hint="비워두면 제목을 씁니다.">
          <input
            className="input input-bordered input-sm w-full"
            value={navLabel}
            maxLength={50}
            onChange={(e) => setNavLabel(e.target.value)}
          />
        </Field>
        <Field label="메뉴 순서">
          <input
            type="number"
            min={0}
            className="input input-bordered input-sm w-full"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
          />
        </Field>
      </div>

      <label className="label cursor-pointer justify-start gap-3">
        <input
          type="checkbox"
          className="toggle toggle-sm"
          checked={showInNav}
          onChange={(e) => setShowInNav(e.target.checked)}
        />
        <span className="label-text text-sm">상단 메뉴에 표시</span>
      </label>

      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>
          취소
        </button>
        <button
          className="btn btn-primary btn-sm"
          disabled={!title.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          저장
        </button>
      </div>
    </Card>
  );
}
