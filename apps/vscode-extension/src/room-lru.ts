// RoomLru (Story 10.5, AC2) — a tiny LRU over room ids that bounds how many room webview panels
// are kept "warm" with `retainContextWhenHidden`.
//
// WHY a host-side LRU (Rule 3 constraint): `WebviewPanelOptions.retainContextWhenHidden` is
// `readonly` on the installed @types/vscode (set at `createWebviewPanel` time, NOT mutable on a
// live panel). So the LRU cannot un-retain a panel after creation; instead it answers ONE question
// at OPEN time — "should the panel for this room be created RETAINED?" — and bounds memory by
// capping how many of the MOST-RECENT rooms get the retained treatment. The N most-recently-touched
// rooms are retained; a room outside the top-N window (re)opens NON-retained, so it re-renders on
// focus (the webview re-initializes + the bridge re-feeds the model) — bounded memory, correct
// re-render. The order updates on every touch (open OR reveal/focus), so an actively-used room
// stays warm and a stale one falls out.
//
// PURE + unit-testable: no `vscode`, no DOM, no panel refs — just an ordered list of room ids and a
// cap. The manager owns the panel lifecycle; this owns only the order + the retain decision.

/** The default number of most-recent rooms kept warm (retainContextWhenHidden). */
export const DEFAULT_RETAIN_CAP = 4;

/**
 * A bounded most-recently-used ordering of room ids. `touch(roomId)` records a room as the
 * most-recent; `shouldRetain(roomId)` answers whether that room is within the top-`cap` window
 * (i.e. should be/was created retained). The list is unbounded in LENGTH (it tracks every touched
 * room for correct re-touch ordering), but only the top-`cap` entries are "retained" — that is the
 * bound that matters for memory (how many panels hold their DOM alive).
 */
export class RoomLru {
  /** Most-recent first. */
  private order: string[] = [];
  private readonly cap: number;

  constructor(cap: number = DEFAULT_RETAIN_CAP) {
    if (!Number.isInteger(cap) || cap < 1) {
      throw new Error(`RoomLru cap must be a positive integer (got ${cap}).`);
    }
    this.cap = cap;
  }

  /** The configured retain cap (the top-N window size). */
  get retainCap(): number {
    return this.cap;
  }

  /**
   * Record `roomId` as the most-recently-used (move-to-front). Called on open AND on reveal/focus
   * so the active room stays warm. Returns whether the room is NOW within the retain window (i.e.
   * a freshly-opened panel should be created retained).
   */
  touch(roomId: string): boolean {
    const existing = this.order.indexOf(roomId);
    if (existing !== -1) {
      this.order.splice(existing, 1);
    }
    this.order.unshift(roomId);
    return this.shouldRetain(roomId);
  }

  /** Whether `roomId` is currently within the top-`cap` most-recent window. */
  shouldRetain(roomId: string): boolean {
    const idx = this.order.indexOf(roomId);
    return idx !== -1 && idx < this.cap;
  }

  /** Drop a room from the order entirely (its panel was closed/disposed). */
  remove(roomId: string): void {
    const idx = this.order.indexOf(roomId);
    if (idx !== -1) {
      this.order.splice(idx, 1);
    }
  }

  /**
   * The room ids currently within the retain window (top-`cap`), most-recent first. The rooms whose
   * panels should be holding their DOM alive.
   */
  retained(): string[] {
    return this.order.slice(0, this.cap);
  }

  /** The full touch order (most-recent first) — for tests/diagnostics. */
  snapshot(): string[] {
    return [...this.order];
  }
}
