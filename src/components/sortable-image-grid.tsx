import { ReactNode } from "react";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Item = { id: string };

interface SortableImageGridProps<T extends Item> {
  items: T[];
  onReorder: (nextItems: T[]) => void;
  renderItem: (item: T, index: number, dragHandleProps: DragHandleProps) => ReactNode;
  className?: string;
}

export type DragHandleProps = {
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown> | undefined;
  "aria-label": string;
};

export function SortableImageGrid<T extends Item>({
  items,
  onReorder,
  renderItem,
  className,
}: SortableImageGridProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
        <ul
          role="list"
          aria-label="Product images, drag to reorder. Use space to pick up, arrow keys to move, space to drop."
          className={className ?? "grid grid-cols-2 md:grid-cols-4 gap-3"}
        >
          {items.map((item, index) => (
            <SortableTile key={item.id} id={item.id} index={index} total={items.length}>
              {(handle) => renderItem(item, index, handle)}
            </SortableTile>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableTile({
  id,
  index,
  total,
  children,
}: {
  id: string;
  index: number;
  total: number;
  children: (handle: DragHandleProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  } as React.CSSProperties;
  const handle: DragHandleProps = {
    attributes: attributes as unknown as Record<string, unknown>,
    listeners: listeners as unknown as Record<string, unknown> | undefined,
    "aria-label": `Image ${index + 1} of ${total}. Press space to reorder.`,
  };
  return (
    <li ref={setNodeRef} style={style} className="list-none">
      {children(handle)}
    </li>
  );
}