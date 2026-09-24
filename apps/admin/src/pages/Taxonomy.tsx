import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { adminApi } from '../lib/api';
import type { CategoryNode } from '../lib/types';
import SlugField from '../components/SlugField';
import SortableList from '../components/SortableList';
import { Card, EmptyState, ErrorNotice, Field, Loading, PageHeader } from '../components/ui';

type Tab = 'categories' | 'tags' | 'series';

export default function Taxonomy() {
  const [tab, setTab] = useState<Tab>('categories');

  return (
    <>
      <PageHeader title="분류" description="카테고리는 여러 단계로 중첩할 수 있습니다." />

      <div role="tablist" className="tabs tabs-box mb-6 w-fit">
        {(
          [
            ['categories', '카테고리'],
            ['tags', '태그'],
            ['series', '시리즈'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            className={`tab ${tab === value ? 'tab-active' : ''}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'categories' && <Categories />}
      {tab === 'tags' && <Tags />}
      {tab === 'series' && <SeriesList />}
    </>
  );
}

// ---------------------------------------------------------------------------

function flatten(nodes: CategoryNode[], depth = 0): { node: CategoryNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)]);
}

function Categories() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CategoryNode | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['categories'],
    queryFn: () => adminApi.categories.tree().then((r) => r.data),
  });

  const flat = useMemo(() => flatten(data ?? []), [data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['categories'] });
    setEditing(null);
    setCreating(false);
  };

  const remove = useMutation({
    mutationFn: (id: number) => adminApi.categories.remove(id),
    onSuccess: invalidate,
  });

  /* 순서는 화면에서 먼저 바뀐다. 실패하면 다시 받아와 원래대로 돌아간다. */
  const reorder = useMutation({
    mutationFn: (ids: number[]) => adminApi.categories.reorder(ids),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['categories'] }),
  });

  if (isLoading) return <Loading />;

  return (
    <>
      <ErrorNotice error={error ?? remove.error ?? reorder.error} />

      <div className="mb-4">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            setCreating(true);
            setEditing(null);
          }}
        >
          카테고리 추가
        </button>
      </div>

      {(creating || editing) && (
        <CategoryForm
          key={editing?.id ?? 'new'}
          category={editing}
          options={flat}
          onDone={invalidate}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {(data ?? []).length === 0 ? (
        <EmptyState message="카테고리가 없습니다." />
      ) : (
        <Card className="p-0">
          <p className="text-base-content/50 border-base-300 border-b px-4 py-2 text-xs">
            끌어서 순서를 바꿉니다. 같은 단계(형제)끼리만 움직입니다 — 상위를 바꾸려면 수정에서 상위
            분류를 고르세요.
          </p>
          <CategoryLevel
            nodes={data ?? []}
            depth={0}
            onReorder={(ids) => reorder.mutate(ids)}
            onEdit={(node) => {
              setEditing(node);
              setCreating(false);
            }}
            onRemove={(node) => {
              if (confirm(`"${node.name}" 카테고리를 삭제할까요?`)) remove.mutate(node.id);
            }}
          />
        </Card>
      )}
    </>
  );
}

/**
 * 한 단계(형제 묶음)를 그리고, 그 아래를 다시 같은 방식으로 그린다.
 *
 * 단계마다 SortableList 를 따로 두는 것이 핵심이다. 그래야 다른 단계로는
 * 끌어 놓을 수 없고, 서버도 "같은 상위끼리만" 이라는 같은 규칙을 지킨다.
 */
function CategoryLevel({
  nodes,
  depth,
  onReorder,
  onEdit,
  onRemove,
}: {
  nodes: CategoryNode[];
  depth: number;
  onReorder: (ids: number[]) => void;
  onEdit: (node: CategoryNode) => void;
  onRemove: (node: CategoryNode) => void;
}) {
  return (
    <SortableList
      items={nodes}
      getId={(node) => node.id}
      onReorder={onReorder}
      disabled={nodes.length < 2}
      renderItem={(node, handle) => (
        <div className="border-base-300 border-b last:border-b-0">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-6 shrink-0 text-center" style={{ marginLeft: `${depth * 1.25}rem` }}>
              {handle}
            </span>

            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium">{node.name}</span>
              <span className="text-base-content/40 ml-2 font-mono text-xs">{node.path}</span>
            </div>

            <span className="text-base-content/50 text-xs">글 {node.postCount}</span>
            <button className="btn btn-ghost btn-xs" onClick={() => onEdit(node)}>
              수정
            </button>
            <button className="btn btn-ghost btn-xs text-error" onClick={() => onRemove(node)}>
              삭제
            </button>
          </div>

          {node.children.length > 0 && (
            <CategoryLevel
              nodes={node.children}
              depth={depth + 1}
              onReorder={onReorder}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          )}
        </div>
      )}
    />
  );
}

function CategoryForm({
  category,
  options,
  onDone,
  onCancel,
}: {
  category: CategoryNode | null;
  options: { node: CategoryNode; depth: number }[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [slug, setSlug] = useState(category?.slug ?? '');
  const [parentId, setParentId] = useState<number | null>(category?.parentId ?? null);
  const [description, setDescription] = useState(category?.description ?? '');

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        slug: slug || null,
        parentId,
        description: description || null,
      };
      return category
        ? adminApi.categories.update(category.id, body)
        : adminApi.categories.create(body);
    },
    onSuccess: onDone,
  });

  /**
   * 자기 자신과 자기 자손은 상위로 고를 수 없다.
   * 서버도 막지만, 고를 수 없게 해두는 편이 친절하다.
   */
  const selectable = options.filter(({ node }) => {
    if (!category) return true;
    return node.id !== category.id && !node.path.startsWith(`${category.path}/`);
  });

  return (
    <Card className="mb-4 space-y-4">
      <h2 className="font-semibold">{category ? '카테고리 수정' : '카테고리 추가'}</h2>
      <ErrorNotice error={save.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="이름" required>
          <input
            className="input input-bordered input-sm w-full"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <SlugField
          value={slug}
          onChange={setSlug}
          source={name}
          sourceLabel="이름"
          currentSlug={category?.slug}
        />

        <Field label="상위 카테고리" hint="최대 6단계까지 중첩할 수 있습니다.">
          <select
            className="select select-bordered select-sm w-full"
            value={parentId ?? ''}
            onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">최상위</option>
            {selectable.map(({ node, depth }) => (
              <option key={node.id} value={node.id}>
                {'  '.repeat(depth)}
                {depth > 0 ? '└ ' : ''}
                {node.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="설명">
        <textarea
          className="textarea textarea-bordered textarea-sm w-full"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      {category && parentId !== category.parentId && (
        <div role="alert" className="alert alert-info text-sm">
          상위를 바꾸면 하위 카테고리의 주소도 함께 바뀝니다.
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>
          취소
        </button>
        <button
          className="btn btn-primary btn-sm"
          disabled={!name.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          저장
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function Tags() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['tags'],
    queryFn: () => adminApi.tags.list().then((r) => r.data),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tags'] });

  const create = useMutation({
    mutationFn: () => adminApi.tags.create({ name }),
    onSuccess: () => {
      setName('');
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => adminApi.tags.remove(id),
    onSuccess: invalidate,
  });

  if (isLoading) return <Loading />;

  return (
    <>
      <ErrorNotice error={error ?? create.error ?? remove.error} />

      <Card className="mb-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <input
            className="input input-bordered input-sm flex-1"
            placeholder="새 태그 이름"
            value={name}
            maxLength={50}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!name.trim() || create.isPending}
          >
            추가
          </button>
        </form>
      </Card>

      {!data || data.length === 0 ? (
        <EmptyState message="태그가 없습니다." />
      ) : (
        <Card>
          <div className="flex flex-wrap gap-2">
            {data.map((tag) => (
              <span key={tag.id} className="badge badge-lg gap-2">
                {tag.name}
                <button
                  className="text-error hover:opacity-70"
                  aria-label={`${tag.name} 삭제`}
                  onClick={() => {
                    if (confirm(`"${tag.name}" 태그를 삭제할까요?\n글에서 이 태그만 떨어집니다.`))
                      remove.mutate(tag.id);
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function SeriesList() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['series'],
    queryFn: () => adminApi.series.list().then((r) => r.data),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['series'] });

  const create = useMutation({
    mutationFn: () => adminApi.series.create({ title }),
    onSuccess: () => {
      setTitle('');
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => adminApi.series.remove(id),
    onSuccess: invalidate,
  });

  if (isLoading) return <Loading />;

  return (
    <>
      <ErrorNotice error={error ?? create.error ?? remove.error} />

      <Card className="mb-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate();
          }}
        >
          <input
            className="input input-bordered input-sm flex-1"
            placeholder="새 시리즈 제목"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!title.trim() || create.isPending}
          >
            추가
          </button>
        </form>
      </Card>

      {!data || data.length === 0 ? (
        <EmptyState message="시리즈가 없습니다." />
      ) : (
        <Card className="p-0">
          <ul className="divide-base-300 divide-y">
            {data.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-base-content/40 font-mono text-xs">{item.slug}</p>
                </div>
                <button
                  className="btn btn-ghost btn-xs text-error"
                  onClick={() => {
                    if (
                      confirm(
                        `"${item.title}" 시리즈를 삭제할까요?\n글은 남고 시리즈 연결만 풀립니다.`,
                      )
                    )
                      remove.mutate(item.id);
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
