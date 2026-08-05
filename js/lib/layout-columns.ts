import { ColumnSpec, ColumnGeometry } from "../cpt-viewer";


/** slot layout: assigns each column's x — left-side columns stack outward
 * at negative x, the rest to the right of the plot; a column with
 * gapBefore leaves one slot empty before it. Returns the resulting svg
 * extent: totalWidth, and x0 where left columns extend the viewBox into
 * negative x instead of shifting the plot, so every plot coordinate stays
 * put (the extra gap keeps the boundary-depth labels, which reach left of
 * the column, visible) */
export function layoutColumns(
  columns: ColumnSpec[],
  width: number,
  column: ColumnGeometry) {
  const slotWidth = column.width + column.gap;
  const columnX = (i: number) => width + column.gap + i * slotWidth;
  let slot = 0;
  let leftSlot = 0;

  for (const column of columns) {
    if (column.side === "left") {
      leftSlot += 1;
      column.x = -leftSlot * slotWidth;
    } else {
      if (column.gapBefore) {
        slot += 1;
      }
      column.x = columnX(slot);
      slot += 1;
    }
  }
  
  const totalWidth = width + slot * slotWidth;
  const x0 = leftSlot ? -leftSlot * slotWidth - column.gap : 0;
  
  return { totalWidth, x0 };
}
