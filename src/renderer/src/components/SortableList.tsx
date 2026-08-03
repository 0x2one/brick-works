import { useState, type CSSProperties, type ReactNode, type ReactElement } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
  type DraggableAttributes
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type SortableListeners = ReturnType<typeof useSortable>['listeners']

export type SortableItemApi = {
  setNodeRef: (node: HTMLElement | null) => void
  setActivatorNodeRef: (node: HTMLElement | null) => void
  style: CSSProperties
  attributes: DraggableAttributes
  listeners: SortableListeners
  isDragging: boolean
}

type IdItem = { id: string }

const dropAnimation: DropAnimation = {
  duration: 220,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.4'
      }
    }
  })
}

function SortableItem({
  id,
  children
}: {
  id: string
  children: (api: SortableItemApi) => ReactNode
}): React.JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id })

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 1 : undefined,
    opacity: isDragging ? 0.35 : undefined,
    willChange: transform ? 'transform' : undefined
  }

  return (
    <>
      {children({
        setNodeRef,
        setActivatorNodeRef,
        style,
        attributes,
        listeners,
        isDragging
      })}
    </>
  )
}

type SortableListProps<T extends IdItem> = {
  items: T[]
  onReorder: (next: T[]) => void
  children: (item: T, api: SortableItemApi) => ReactNode
  renderOverlay?: (item: T) => ReactNode
  className?: string
}

export function SortableList<T extends IdItem>({
  items,
  onReorder,
  children,
  renderOverlay,
  className
}: SortableListProps<T>): ReactElement {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const activeItem = activeId ? (items.find((item) => item.id === activeId) ?? null) : null

  const handleDragStart = (event: DragStartEvent): void => {
    setActiveId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    setActiveId(null)
    if (!over) return
    const activeIdStr = String(active.id)
    const overIdStr = String(over.id)
    if (activeIdStr === overIdStr) return
    const oldIndex = items.findIndex((item) => item.id === activeIdStr)
    const newIndex = items.findIndex((item) => item.id === overIdStr)
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
    onReorder(arrayMove(items, oldIndex, newIndex))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className={className}>
          {items.map((item) => (
            <SortableItem key={item.id} id={item.id}>
              {(api) => children(item, api)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={dropAnimation}>
        {activeItem
          ? (renderOverlay?.(activeItem) ?? (
              <div className="pointer-events-none rounded-lg shadow-[0_10px_24px_rgba(0,0,0,0.16)]">
                {children(activeItem, {
                  setNodeRef: () => {},
                  setActivatorNodeRef: () => {},
                  style: { opacity: 1 },
                  attributes: {} as DraggableAttributes,
                  listeners: undefined,
                  isDragging: false
                })}
              </div>
            ))
          : null}
      </DragOverlay>
    </DndContext>
  )
}
