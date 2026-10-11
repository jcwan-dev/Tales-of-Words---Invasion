import type { StatusId, StatusTag } from "../content/types.ts";
import { STATUS_COUNT, statusIndex } from "./status-set.ts";
import { TAGGED } from "./statuses/registry.ts";
import type { CombatUnit } from "./unit.ts";

/**
 * Slow decay (spec: Synergy effects): while the holder is alive, the covered statuses on the covered
 * units lose a stack only on even rounds. `statuses` names them by id or by tag; `whose` is the
 * holder's own statuses or those of the units on the other side.
 */
export interface SlowDecay {
  statuses: readonly StatusId[] | { tag: StatusTag };
  whose: "own" | "enemies";
}

/**
 * Turn-time decay rules for one fight: slow decay and decay floors, resolved once at beginCombat into
 * dense per-unit tables, so asking "may this stack decay now?" allocates nothing and compares no ids
 * (code rules 2 and 6). Applies only to decay (turn-end ticking and the DoT −1), never to charges,
 * consumes or meter resets: those paths don't ask.
 */
export class DecayRules {
  readonly #units: readonly CombatUnit[];
  /** Per unit, per status index: 1 if the unit slows that status on itself. */
  readonly #slowOwn: readonly Uint8Array[];
  /** Per unit, per status index: 1 if the unit slows that status on the other side. */
  readonly #slowEnemies: readonly Uint8Array[];
  /** Per unit, per status index: the decay floor (0 = none). */
  readonly #floors: readonly Float64Array[];
  /** The current round; set by the turn controller before turn hooks run. */
  round = 1;

  constructor(units: readonly CombatUnit[]) {
    this.#units = units;
    const own: Uint8Array[] = [];
    const enemies: Uint8Array[] = [];
    const floors: Float64Array[] = [];
    for (const u of units) {
      const o = new Uint8Array(STATUS_COUNT);
      const e = new Uint8Array(STATUS_COUNT);
      for (const entry of u.traits.slowDecay ?? []) {
        const mask = entry.whose === "own" ? o : e;
        const covered = entry.statuses;
        if ("tag" in covered) for (const i of TAGGED[covered.tag]) mask[i] = 1;
        else for (const id of covered) mask[statusIndex(id)] = 1;
      }
      const f = new Float64Array(STATUS_COUNT);
      const fl = u.traits.decayFloors;
      if (fl !== undefined) {
        for (const [id, min] of Object.entries(fl) as [StatusId, number | undefined][]) {
          if (min !== undefined && min > 0) f[statusIndex(id)] = Math.floor(min);
        }
      }
      own.push(o);
      enemies.push(e);
      floors.push(f);
    }
    this.#slowOwn = own;
    this.#slowEnemies = enemies;
    this.#floors = floors;
  }

  /**
   * May `status` on `owner` lose a stack to decay now? No on odd rounds while a living holder slows it
   * ("alive" is checked now, at each decay; several holders don't stack), and no when the stacks are
   * at or below the owner's floor for it (a floor never raises a status).
   */
  allows(owner: CombatUnit, status: StatusId): boolean {
    const i = statusIndex(status);
    const units = this.#units;
    let ownerIndex = -1;
    for (let k = 0; k < units.length; k++) {
      if (units[k] === owner) {
        ownerIndex = k;
        break;
      }
    }
    if (ownerIndex >= 0 && owner.statuses.stacksAt(i) <= (this.#floors[ownerIndex]?.[i] ?? 0)) return false;
    if (this.round % 2 === 0) return true;
    for (let k = 0; k < units.length; k++) {
      const h = units[k];
      if (h === undefined || h.fallen) continue;
      if (h === owner ? this.#slowOwn[k]?.[i] === 1 : h.side !== owner.side && this.#slowEnemies[k]?.[i] === 1) return false;
    }
    return true;
  }
}
