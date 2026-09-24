import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * 끌어서 순서를 바꾸는 목록.
 *
 * 순서는 화면에서 먼저 바꾸고 서버에 알린다. 서버 응답을 기다렸다가 움직이면
 * 놓은 자리에서 항목이 잠깐 원래 자리로 돌아갔다 오는 게 보인다.
 * 서버가 실패하면 onReorder 를 부른 쪽에서 목록을 다시 불러오므로 되돌아온다.
 *
 * 손잡이(⠿)를 따로 둔 이유는 줄 안의 버튼 때문이다. 줄 전체를 잡게 하면
 * '수정' 을 누르려다 끌어버리는 일이 생긴다.
 */

interface Props<T> {
  items: T[];
  getId: (item: T) => number;
  /** 바뀐 전체 순서를 id 배열로 넘긴다. */
  onReorder: (ids: number[]) => void;
  renderItem: (item: T, handle: ReactNode) => ReactNode;
  /** 항목이 하나뿐이면 끌 이유가 없다. */
  disabled?: boolean;
}

export default function SortableList<T>({
  items,
  getId,
  onReorder,
  renderItem,
  disabled = false,
}: Props<T>) {
  const [order, setOrder] = useState(items);

  // 서버에서 다시 받아오면 그 순서를 따른다.
  useEffect(() => setOrder(items), [items]);

  const sensors = useSensors(
    // 5px 움직여야 끌기로 본다. 그래야 그냥 누른 것과 구분된다.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = order.findIndex((item) => getId(item) === active.id);
    const to = order.findIndex((item) => getId(item) === over.id);
    if (from === -1 || to === -1) return;

    const next = arrayMove(order, from, to);
    setOrder(next);
    onReorder(next.map(getId));
  };

  const ids = order.map(getId);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
        {order.map((item) => (
          <SortableRow key={getId(item)} id={getId(item)} disabled={disabled}>
            {(handle) => renderItem(item, handle)}
          </SortableRow>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  disabled,
  children,
}: {
  id: number;
  disabled: boolean;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  const handle = disabled ? null : (
    <button
      type="button"
      className="btn btn-ghost btn-xs text-base-content/30 hover:text-base-content cursor-grab px-1 active:cursor-grabbing"
      aria-label="끌어서 순서 바꾸기"
      {...attributes}
      {...listeners}
    >
      ⠿
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // 끌고 있는 줄은 살짝 띄워 어디에 있는지 보이게 한다.
        zIndex: isDragging ? 10 : undefined,
        position: isDragging ? 'relative' : undefined,
        opacity: isDragging ? 0.9 : undefined,
      }}
      className={isDragging ? 'bg-base-100 rounded-lg shadow-lg' : undefined}
    >
      {children(handle)}
    </div>
  );
}
