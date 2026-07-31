import { RForceOrder } from "./types";

let _draggedOrder: RForceOrder | null = null;

export function setDraggedOrder(order: RForceOrder | null) {
  _draggedOrder = order;
}

export function getDraggedOrder(): RForceOrder | null {
  return _draggedOrder;
}
