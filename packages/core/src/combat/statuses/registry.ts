import { STATUS_IDS, STATUS_TAGS, type StatusId, type StatusTag } from "../../content/types.ts";
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
import {
  HIT_HOOK_NAMES,
  TURN_HOOK_NAMES,
  type GateHook,
  type HitHook,
  type HitHookName,
  type StatusDef,
  type StatusModule,
  type TurnHook,
  type TurnHookName,
} from "./types.ts";

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

/** Dense indices of the statuses carrying each tag, built once at load (for Afflictions and stack scaling). */
export const TAGGED: Readonly<Record<StatusTag, readonly number[]>> = (() => {
  const lists = {} as Record<StatusTag, number[]>;
  for (const tag of STATUS_TAGS) lists[tag] = [];
  for (const id of STATUS_IDS) for (const tag of MODULES[id].def.tags) lists[tag].push(statusIndex(id));
  return lists;
})();

/** One hook registration: the hook, and the dense index and id of the status that owns it. */
export interface HookEntry<H> {
  readonly index: number;
  readonly id: StatusId;
  readonly hook: H;
}

/**
 * Status ids in dispatch order: by `priority`, ties in `STATUS_IDS` order. Every hook list
 * follows it, so the spec's orders (turn start, action gate) come from data.
 */
export const DISPATCH_ORDER: readonly StatusId[] = STATUS_IDS.map((id, i) => ({ id, i }))
  .sort((a, b) => MODULES[a.id].def.priority - MODULES[b.id].def.priority || a.i - b.i)
  .map((e) => e.id);

function hookList<H>(pick: (m: StatusModule) => H | undefined): readonly HookEntry<H>[] {
  const list: HookEntry<H>[] = [];
  for (const id of DISPATCH_ORDER) {
    const hook = pick(MODULES[id]);
    if (hook !== undefined) list.push({ index: statusIndex(id), id, hook });
  }
  return list;
}

/**
 * Pre-sorted hook lists (spec: Combat core design): per hook point, only the statuses that
 * implement it, in dispatch order. Built once at load; dispatch never touches the others.
 */
export const HIT_HOOKS: Readonly<Record<HitHookName, readonly HookEntry<HitHook>[]>> = (() => {
  const lists = {} as Record<HitHookName, readonly HookEntry<HitHook>[]>;
  for (const name of HIT_HOOK_NAMES) lists[name] = hookList((m) => m.hooks[name]);
  return lists;
})();

export const TURN_HOOKS: Readonly<Record<TurnHookName, readonly HookEntry<TurnHook>[]>> = (() => {
  const lists = {} as Record<TurnHookName, readonly HookEntry<TurnHook>[]>;
  for (const name of TURN_HOOK_NAMES) lists[name] = hookList((m) => m.hooks[name]);
  return lists;
})();

export const GATE_HOOKS: readonly HookEntry<GateHook>[] = hookList((m) => m.hooks.gateAction);
