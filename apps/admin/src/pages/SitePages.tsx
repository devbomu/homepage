import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';

import { adminApi } from '../lib/api';
import { POST_STATUSES, POST_STATUS_LABEL, type PostStatus, type SitePage } from '../lib/types';
import SlugField from '../components/SlugField';
import SortableList from '../components/SortableList';
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

  /*
   * 순서는 화면에서 먼저 바뀌고(SortableList), 여기서는 서버에 알리기만 한다.
   * 실패하면 목록을 다시 받아 원래 순서로 돌아간다.
   */
  const reorder = useMutation({
    mutationFn: (ids: number[]) => adminApi.pages.reorder(ids),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['pages'] }),
  });

  // 메뉴에 넣은 것만 순서가 뜻이 있다. 나머지는 제목 순으로 둔다.
  const inNav = useMemo(() => (data ?? []).filter((page) => page.showInNav), [data]);
  const offNav = useMemo(
    () =>
      (data ?? [])
        .filter((page) => !page.showInNav)
        .sort((a, b) => a.title.localeCompare(b.title, 'ko')),
    [data],
  );

  const rowProps = {
    onEdit: (page: SitePage) => {
      setEditing(page);
      setCreating(false);
    },
    onRemove: (page: SitePage) => {
      if (confirm(`"${page.title}" 페이지를 삭제할까요?`)) remove.mutate(page.id);
    },
  };

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

      <ErrorNotice error={error ?? remove.error ?? reorder.error} />

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
        <div className="space-y-6">
          <section>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-sm font-semibold">상단 메뉴</h2>
              <span className="text-base-content/50 text-xs">
                끌어서 순서를 바꿉니다. 공개 사이트 메뉴에 이 차례로 나옵니다.
              </span>
            </div>

            {inNav.length === 0 ? (
              <EmptyState message="메뉴에 넣은 페이지가 없습니다. 페이지를 수정해 '상단 메뉴에 표시'를 켜세요." />
            ) : (
              <Card className="divide-base-300 divide-y p-0">
                <SortableList
                  items={inNav}
                  getId={(page) => page.id}
                  onReorder={(ids) => reorder.mutate(ids)}
                  disabled={inNav.length < 2}
                  renderItem={(page, handle) => (
                    <PageRow page={page} handle={handle} {...rowProps} />
                  )}
                />
              </Card>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-sm font-semibold">메뉴에 없는 페이지</h2>
              <span className="text-base-content/50 text-xs">
                주소를 아는 사람만 들어옵니다. 순서는 의미가 없습니다.
              </span>
            </div>

            {offNav.length === 0 ? (
              <EmptyState message="모든 페이지가 메뉴에 있습니다." />
            ) : (
              <Card className="divide-base-300 divide-y p-0">
                {offNav.map((page) => (
                  <PageRow key={page.id} page={page} handle={null} {...rowProps} />
                ))}
              </Card>
            )}
          </section>
        </div>
      )}
    </>
  );
}

/** 목록의 한 줄. 메뉴 쪽은 손잡이가 붙고, 아닌 쪽은 자리만 비워 둔다. */
function PageRow({
  page,
  handle,
  onEdit,
  onRemove,
}: {
  page: SitePage;
  handle: ReactNode;
  onEdit: (page: SitePage) => void;
  onRemove: (page: SitePage) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="w-6 shrink-0 text-center">{handle}</span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{page.title}</p>
        <p className="text-base-content/40 font-mono text-xs">/{page.slug}</p>
      </div>

      {page.navLabel && page.navLabel !== page.title && (
        <span className="badge badge-ghost badge-sm">메뉴: {page.navLabel}</span>
      )}
      <span
        className={`badge badge-sm ${page.status === 'published' ? 'badge-success' : 'badge-ghost'}`}
      >
        {POST_STATUS_LABEL[page.status]}
      </span>

      <button className="btn btn-ghost btn-xs" onClick={() => onEdit(page)}>
        수정
      </button>
      <button className="btn btn-ghost btn-xs text-error" onClick={() => onRemove(page)}>
        삭제
      </button>
    </div>
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

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        slug: slug || null,
        content,
        status,
        showInNav,
        navLabel: navLabel || null,
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
        <SlugField value={slug} onChange={setSlug} source={title} currentSlug={page?.slug} />
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
