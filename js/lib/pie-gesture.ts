import { wedgeAt } from "./pie-menu";
import type { ArcAngles } from "./pie-menu";
import type { Layer } from "./types";

// the soil-class pie's gesture decisions, pure: a closure factory in
// the repo's d3-factory style owning all the press-drag-release state
// (drag-slop intent, dead-zone release keeping the pie open,
// trailing-click swallowing, keyboard wedge-walking). Each input event
// answers with a single command the adapter executes against the DOM;
// the adapter never reads the state directly, so the pie it shows and
// the pick it commits can't disagree. Dismissal (outside pointer,
// wheel, Escape) stays with the adapter — it calls reset()

/** what the adapter must do in response to an input event */
export type PieCommand =
  /** nothing — the event carried no gesture meaning */
  | { kind: "none" }
  /** show the pie at (x, y) for layer, with armed highlighted */
  | { kind: "open"; x: number; y: number; layer: Layer; armed: number | null }
  /** highlight wedge index (null: dead zone — show the current class) */
  | { kind: "arm"; index: number | null }
  /** assign class index to layer and hide the pie */
  | { kind: "commit"; index: number; layer: Layer };

interface PieGestureProps {
  /** the pie layout's arc datums — the angular contract picks hit-test
      against, in soil-class order */
  arcs: ArcAngles[];
  /** px radius around the press that arms no wedge */
  deadZone: number;
  /** movement in px that reads as drag intent */
  slop?: number;
}

export interface PieGesture {
  /** a primary-button press on a layer arms the gesture */
  press(x: number, y: number, layer: Layer): void;
  /** pointer moved (same coordinate space as press) */
  move(x: number, y: number): PieCommand;
  /** the button came up: commit the armed wedge, or keep a dead-zone
      release open for click-to-pick */
  release(): PieCommand;
  /** the click after a press: swallowed when a gesture just ran, else
      it opens the pie under the pointer */
  click(x: number, y: number, layer: Layer): PieCommand;
  /** keyboard picking while the pie is open: arrows walk the wedges
      from the armed one, else from active (the layer's current class
      index, -1 for classless); Enter/Space commits the armed wedge */
  key(key: string, active: number): PieCommand;
  /** dismiss: forget the gesture and the open pie */
  reset(): void;
  /** true while a press is being tracked — lets the adapter skip
      pointer math on unrelated moves */
  pressed(): boolean;
  /** the layer the open pie edits, null when closed */
  layer(): Layer | null;
}

const keyStep: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

const none: PieCommand = { kind: "none" };

export function pieGesture({ arcs, deadZone, slop = 4 }: PieGestureProps): PieGesture {
  let press: { x: number; y: number; layer: Layer } | null = null;
  let open = false; // the pie is open with the button still down
  let suppressClick = false; // a gesture just ran; swallow its trailing click
  let pieFor: Layer | null = null;
  let armedIndex: number | null = null;

  const commit = (index: number): PieCommand => {
    const layer = pieFor!;
    pieFor = null;
    armedIndex = null;
    return { kind: "commit", index, layer };
  };

  return {
    press(x, y, layer) {
      suppressClick = false;
      press = { x, y, layer };
    },

    move(x, y) {
      if (!press) {
        return none;
      }

      const dx = x - press.x;
      const dy = y - press.y;

      if (open) {
        armedIndex = wedgeAt(arcs, dx, dy, deadZone);
        return { kind: "arm", index: armedIndex };
      }
      if (Math.hypot(dx, dy) < slop) {
        return none;
      }

      // drag intent: open where the press was, arming any wedge a fast
      // flick already crossed into
      open = true;
      pieFor = press.layer;
      armedIndex = wedgeAt(arcs, dx, dy, deadZone);
      return { kind: "open", x: press.x, y: press.y, layer: pieFor, armed: armedIndex };
    },

    release() {
      if (!press) {
        return none;
      }
      press = null;

      if (!open) {
        return none; // a quick click — click() opens the pie
      }

      open = false;
      suppressClick = true;

      if (armedIndex != null) {
        return commit(armedIndex);
      }
      return none; // a dead-zone release keeps the pie open for click-to-pick
    },

    click(x, y, layer) {
      if (suppressClick) {
        suppressClick = false;
        return none;
      }
      pieFor = layer;
      armedIndex = null;
      return { kind: "open", x, y, layer, armed: null };
    },

    key(key, active) {
      if (!pieFor) {
        return none;
      }

      const step = keyStep[key];
      if (step != null) {
        // walk from the armed wedge, else the layer's current class; a
        // classless layer starts on the wedge nearest 12 o'clock in
        // the pressed direction
        const count = arcs.length;
        const from = armedIndex ?? (active >= 0 ? active : step > 0 ? -1 : 0);
        armedIndex = (((from + step) % count) + count) % count;
        return { kind: "arm", index: armedIndex };
      }

      if ((key === "Enter" || key === " ") && armedIndex != null) {
        return commit(armedIndex);
      }
      return none;
    },

    reset() {
      press = null;
      open = false;
      pieFor = null;
      armedIndex = null;
    },

    pressed: () => press !== null,
    layer: () => pieFor,
  };
}
