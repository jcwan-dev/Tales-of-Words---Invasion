import { STATUS_IDS, type StatusId } from "../../content/types.ts";
import { statusIndex } from "../status-set.ts";
import { ambushed } from "./ambushed.ts";
import { bleeding } from "./bleeding.ts";
import { burning } from "./burning.ts";
import { dimmed } from "./dimmed.ts";
import { emboldened } from "./emboldened.ts";
import { enfeebled } from "./enfeebled.ts";
import { kindled } from "./kindled.ts";
import { leeching } from "./leeching.ts";
import { paralysed } from "./paralysed.ts";
import { piercing } from "./piercing.ts";
import { poisoned } from "./poisoned.ts";
import { stunned } from "./stunned.ts";
import { thorns } from "./thorns.ts";
import { warded } from "./warded.ts";
import { HIT_HOOK_NAMES, type HitHook, type HitHookName, type StatusDef, type StatusModule } from "./types.ts";

/** Every status, registered once by id. The type makes a missing status a compile error. */
const MODULES: Readonly<Record<StatusId, StatusModule>> = {
  burning,
  poisoned,
  bleeding,
  stunned,
  paralysed,
  ambushed,
  enfeebled,
  dimmed,
  emboldened,
  kindled,
  warded,
  thorns,
  leeching,
  piercing,
};

export const statusModule = (id: StatusId): StatusModule => MODULES[id];

/** Status metadata from the spec's status list. */
export const statusDef = (id: StatusId): StatusDef => MODULES[id].def;

/** One hook registration: the hook and the dense index of the status that owns it. */
export interface HookEntry {
  readonly index: number;
  readonly hook: HitHook;
}

/**
 * Pre-sorted hook lists (spec: Combat core design): per hook point, only the statuses that
 * implement it, in `STATUS_IDS` order. Built once at load; dispatch never touches the others.
 */
export const HIT_HOOKS: Readonly<Record<HitHookName, readonly HookEntry[]>> = (() => {
  const lists = {} as Record<HitHookName, HookEntry[]>;
  for (const name of HIT_HOOK_NAMES) lists[name] = [];
  for (const id of STATUS_IDS) {
    const hooks = MODULES[id].hooks;
    for (const name of HIT_HOOK_NAMES) {
      const hook = hooks[name];
      if (hook !== undefined) lists[name].push({ index: statusIndex(id), hook });
    }
  }
  return lists;
})();
