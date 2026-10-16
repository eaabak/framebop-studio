import {
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import { moveBefore } from "../../lib/reorder";

const DRAG_THRESHOLD_PX = 6;

interface DragState {
  id: string;
  /** Index in the current order that the item would be inserted before. */
  index: number;
  /** Where to draw the insertion marker, in the container's content space. */
  markerX: number;
}

/**
 * Drag-to-reorder for a horizontal row of items.
 *
 * Built on pointer events rather than HTML5 drag and drop on purpose: the
 * desktop shell reserves native drag and drop for files dragged in from the
 * operating system, which disables HTML5 drag and drop inside the webview on
 * some platforms. Pointer events behave the same everywhere.
 *
 * Usage: put `containerRef` on the scrolling row, spread `itemProps(id)` on
 * each item, and render a marker at `drag.markerX` while `drag` is set.
 */
export function useReorder(
  ids: readonly string[],
  onReorder: (ids: string[]) => void,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const latest = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  function locate(id: string, clientX: number): DragState | null {
    const container = containerRef.current;
    if (!container) return null;
    const items = [
      ...container.querySelectorAll<HTMLElement>("[data-reorder-id]"),
    ];
    const bounds = items.map((item) => item.getBoundingClientRect());
    let index = bounds.findIndex((box) => clientX < box.left + box.width / 2);
    if (index === -1) index = items.length;

    const origin =
      container.getBoundingClientRect().left - container.scrollLeft;
    const edge =
      bounds[index]?.left ?? bounds[bounds.length - 1]?.right ?? origin;
    return { id, index, markerX: edge - origin };
  }

  function commit(state: DragState): void {
    const next = moveBefore(ids, state.id, state.index);
    if (next !== ids) onReorder([...next]);
  }

  function itemProps(id: string) {
    return {
      "data-reorder-id": id,
      onPointerDown(event: ReactPointerEvent) {
        if (event.button !== 0) return;
        const startX = event.clientX;
        let dragging = false;

        const move = (moveEvent: PointerEvent) => {
          if (
            !dragging &&
            Math.abs(moveEvent.clientX - startX) < DRAG_THRESHOLD_PX
          )
            return;
          dragging = true;
          latest.current = locate(id, moveEvent.clientX);
          setDrag(latest.current);
        };
        const end = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          if (!dragging) return;
          // The pointerup that ends a drag would otherwise also select the item.
          suppressClick.current = true;
          setTimeout(() => {
            suppressClick.current = false;
          }, 0);
          if (latest.current) commit(latest.current);
          latest.current = null;
          setDrag(null);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
      },
      onClickCapture(event: React.MouseEvent) {
        if (suppressClick.current) {
          event.stopPropagation();
          event.preventDefault();
        }
      },
    };
  }

  return { containerRef, drag, itemProps };
}
