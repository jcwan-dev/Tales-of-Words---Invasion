/**
 * Content validation (spec: Testing strategy, "Content validation").
 * Hand-written so the core keeps zero runtime dependencies. Runs in CI over
 * every content pack, and at load time in development builds.
 */
import { POWER_IDS } from "../combat/power-ids.ts";
import { isStatId, STAT_IDS } from "../model/stats.ts";
import { STATUS_IDS, STATUS_TAGS, TRIGGER_EVENTS, type ContentDef, type ContentKind, type ContentPack } from "./types.ts";

export interface ContentFile {
  readonly path: string;
  readonly data: unknown;
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly issues: readonly ValidationIssue[];
  readonly pack?: ContentPack;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const ID_PATTERN = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;

const KIND_PREFIX: Record<ContentKind, string> = {
  character: "char",
  weapon: "weapon",
  armor: "armor",
  accessory: "accessory",
  path: "path",
  skill: "skill",
  word: "word",
  act: "act",
};

const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);

/** Optional list of story flags: an array of non-empty strings. */
function checkFlagList(c: Checker, v: unknown, field: string): void {
  if (v === undefined) return;
  if (!Array.isArray(v) || !v.every(isStr)) c.fail(field, "must be an array of non-empty strings");
}

/** An act (spec: Run map, `act.json`). Node type ids aren't checked here: validation doesn't know the modules. */
function checkAct(c: Checker, d: Obj): void {
  const steps = d["steps"];
  let min: number | null = null;
  if (!isObj(steps) || !isInt(steps["min"]) || !isInt(steps["max"])) c.fail("steps", "must be { min, max } with integer values");
  else if (steps["min"] < 2) c.fail("steps.min", "must be >= 2");
  else if (steps["max"] < steps["min"]) c.fail("steps.max", "must be >= min");
  else min = steps["min"];

  const weights = d["weights"];
  if (!isObj(weights)) c.fail("weights", "must be an object of node type → weight");
  else {
    let positive = false;
    for (const [type, w] of Object.entries(weights)) {
      if (type.length === 0) c.fail("weights", "node type ids must be non-empty");
      if (!isInt(w) || w < 0) c.fail(`weights.${type}`, "must be an integer >= 0");
      else if (w > 0) positive = true;
    }
    if (!positive) c.fail("weights", "at least one weight must be above 0");
  }

  const fixed = d["fixed"];
  if (!Array.isArray(fixed)) c.fail("fixed", "must be an array of fixed nodes (every act has a \"last\" one, the boss)");
  else {
    const seen = new Set<number | "last">();
    fixed.forEach((n, i) => {
      const f = `fixed[${i}]`;
      if (!isObj(n)) return c.fail(f, "must be { at, type, ref? }");
      const at = n["at"];
      if (at === "last" || (isInt(at) && at >= 1 && (min === null || at <= min - 1))) {
        if (seen.has(at)) c.fail(`${f}.at`, at === "last" ? 'only one fixed node may be "last"' : `two fixed nodes on step ${at}`);
        seen.add(at);
      } else c.fail(`${f}.at`, `must be "last" or an integer from 1 to steps.min − 1`);
      if (!isStr(n["type"])) c.fail(`${f}.type`, "must be a non-empty node type id");
      if (n["ref"] !== undefined && !isStr(n["ref"])) c.fail(`${f}.ref`, "must be a non-empty string");
    });
    if (!seen.has("last")) c.fail("fixed", 'needs exactly one fixed node at "last" (the boss)');
  }

  const routes = d["routes"];
  if (routes !== undefined) {
    if (!Array.isArray(routes)) c.fail("routes", "must be an array of routes");
    else {
      let unconditioned = false;
      routes.forEach((r, i) => {
        const f = `routes[${i}]`;
        if (!isObj(r)) return c.fail(f, "must be { to, flags?, notFlags? }");
        if (!isStr(r["to"])) c.fail(`${f}.to`, "must be an act id");
        checkFlagList(c, r["flags"], `${f}.flags`);
        checkFlagList(c, r["notFlags"], `${f}.notFlags`);
        const empty = (v: unknown): boolean => v === undefined || (Array.isArray(v) && v.length === 0);
        if (empty(r["flags"]) && empty(r["notFlags"])) unconditioned = true;
      });
      if (routes.length > 0 && !unconditioned) c.fail("routes", "at least one route must have no flags and no notFlags, so a route is always open");
    }
  }

  if (d["first"] !== undefined && typeof d["first"] !== "boolean") c.fail("first", "must be a boolean");
}

class Checker {
  readonly issues: ValidationIssue[] = [];
  constructor(private readonly file: string) {}

  fail(field: string, message: string): void {
    this.issues.push({ path: `${this.file}#${field}`, message });
  }
  str(o: Obj, key: string): void {
    if (!isStr(o[key])) this.fail(key, "must be a non-empty string");
  }
  num(o: Obj, key: string, opts: { min?: number; optional?: boolean; integer?: boolean } = {}): void {
    const v = o[key];
    if (v === undefined && opts.optional) return;
    if (!isNum(v)) return this.fail(key, "must be a number");
    if (opts.integer && !Number.isInteger(v)) this.fail(key, "must be an integer");
    if (opts.min !== undefined && v < opts.min) this.fail(key, `must be >= ${opts.min}`);
  }
  stats(o: Obj, key: string): void {
    const v = o[key];
    if (v === undefined) return;
    if (!isObj(v)) return this.fail(key, "must be an object of stat bonuses");
    for (const [stat, amount] of Object.entries(v)) {
      if (!isStatId(stat)) this.fail(`${key}.${stat}`, `unknown stat; expected one of ${STAT_IDS.join(", ")}`);
      if (!isNum(amount) || !Number.isInteger(amount)) this.fail(`${key}.${stat}`, "must be an integer");
    }
  }
  scaling(v: unknown, field: string): void {
    if (v === undefined) return;
    if (!Array.isArray(v)) return this.fail(field, "must be an array");
    const shape = "must be { stat, per }, { afflictions: true, per } or { stacksOfTag, per }";
    v.forEach((s, i) => {
      if (!isObj(s) || !isNum(s["per"])) return this.fail(`${field}[${i}]`, shape);
      const kinds = (s["stat"] !== undefined ? 1 : 0) + (s["afflictions"] !== undefined ? 1 : 0) + (s["stacksOfTag"] !== undefined ? 1 : 0);
      if (kinds !== 1) return this.fail(`${field}[${i}]`, shape);
      if (s["stat"] !== undefined && !isStatId(s["stat"])) this.fail(`${field}[${i}].stat`, `unknown stat; expected one of ${STAT_IDS.join(", ")}`);
      if (s["afflictions"] !== undefined && s["afflictions"] !== true) this.fail(`${field}[${i}].afflictions`, "must be true");
      if (s["stacksOfTag"] !== undefined && !(STATUS_TAGS as readonly unknown[]).includes(s["stacksOfTag"])) {
        this.fail(`${field}[${i}].stacksOfTag`, `unknown tag; expected one of ${STATUS_TAGS.join(", ")}`);
      }
    });
  }
  /** Optional pool tags: an array of non-empty strings. */
  tags(o: Obj): void {
    const v = o["tags"];
    if (v === undefined) return;
    if (!Array.isArray(v)) return this.fail("tags", "must be an array of strings");
    v.forEach((t, i) => {
      if (!isStr(t)) this.fail(`tags[${i}]`, "must be a non-empty string");
    });
  }
  /** Optional powers: { <power id>: integer >= 0 } (spec: Powers). */
  powers(o: Obj): void {
    const v = o["powers"];
    if (v === undefined) return;
    if (!isObj(v)) return this.fail("powers", "must be an object of powers");
    for (const [id, n] of Object.entries(v)) {
      if (!(POWER_IDS as readonly string[]).includes(id)) this.fail(`powers.${id}`, `unknown power; expected one of ${POWER_IDS.join(", ")}`);
      else if (!isNum(n) || !Number.isInteger(n) || n < 0) this.fail(`powers.${id}`, "must be an integer >= 0");
    }
  }
  /** Optional traits: converts, slowDecay and decayFloors, as on a combat unit (spec: Synergy effects). */
  traits(o: Obj): void {
    const v = o["traits"];
    if (v === undefined) return;
    if (!isObj(v)) return this.fail("traits", "must be an object");
    for (const key of Object.keys(v)) {
      if (key !== "converts" && key !== "slowDecay" && key !== "decayFloors") this.fail(`traits.${key}`, "unknown trait; expected converts, slowDecay or decayFloors");
    }
    const isStatus = (x: unknown): boolean => (STATUS_IDS as readonly unknown[]).includes(x);
    const converts = v["converts"];
    if (converts !== undefined) {
      if (!Array.isArray(converts)) this.fail("traits.converts", "must be an array");
      else
        converts.forEach((c, i) => {
          const f = `traits.converts[${i}]`;
          if (!isObj(c)) return this.fail(f, "must be { on, gain, stacks }");
          if (!(TRIGGER_EVENTS as readonly unknown[]).includes(c["on"])) this.fail(`${f}.on`, `must be one of ${TRIGGER_EVENTS.join(", ")}`);
          if (!isStatus(c["gain"])) this.fail(`${f}.gain`, "unknown status id");
          const n = c["stacks"];
          // A convert gives at least 1 stack (spec: Loadout assembly, Details).
          if (!isNum(n) || !Number.isInteger(n) || n < 1) this.fail(`${f}.stacks`, "must be an integer >= 1");
        });
    }
    const slow = v["slowDecay"];
    if (slow !== undefined) {
      if (!Array.isArray(slow)) this.fail("traits.slowDecay", "must be an array");
      else
        slow.forEach((e, i) => {
          const f = `traits.slowDecay[${i}]`;
          if (!isObj(e)) return this.fail(f, "must be { statuses, whose }");
          const st = e["statuses"];
          if (Array.isArray(st)) {
            if (!st.every(isStatus)) this.fail(`${f}.statuses`, "unknown status id");
          } else if (isObj(st)) {
            if (!(STATUS_TAGS as readonly unknown[]).includes(st["tag"])) this.fail(`${f}.statuses.tag`, `unknown tag; expected one of ${STATUS_TAGS.join(", ")}`);
          } else this.fail(`${f}.statuses`, "must be a list of status ids or { tag }");
          if (e["whose"] !== "own" && e["whose"] !== "enemies") this.fail(`${f}.whose`, 'must be "own" or "enemies"');
        });
    }
    const floors = v["decayFloors"];
    if (floors !== undefined) {
      if (!isObj(floors)) this.fail("traits.decayFloors", "must be an object of status floors");
      else
        for (const [id, n] of Object.entries(floors)) {
          if (!isStatus(id)) this.fail(`traits.decayFloors.${id}`, "unknown status id");
          else if (!isNum(n) || !Number.isInteger(n) || n < 0) this.fail(`traits.decayFloors.${id}`, "must be an integer >= 0");
        }
    }
  }
  /** Optional hit count: an integer >= 1. */
  hits(o: Obj, field: string): void {
    const v = o["hits"];
    if (v !== undefined && (!isNum(v) || !Number.isInteger(v) || v < 1)) this.fail(field, "must be an integer >= 1");
  }
  /** Heal and restore Shield scale only with the user (spec: Cards in combat): no target terms. */
  userOnlyScaling(v: unknown, field: string): void {
    if (!Array.isArray(v)) return;
    v.forEach((s, i) => {
      if (isObj(s) && (s["afflictions"] !== undefined || s["stacksOfTag"] !== undefined)) {
        this.fail(`${field}[${i}]`, "heal and restore Shield scale only with the user's stats, never the target's");
      }
    });
  }
  effects(o: Obj): void {
    const list = o["effects"];
    if (!Array.isArray(list) || list.length === 0) return this.fail("effects", "must be a non-empty array");
    list.forEach((e, i) => {
      const f = `effects[${i}]`;
      if (!isObj(e)) return this.fail(f, "must be an object");
      if (e["target"] !== "self" && e["target"] !== "enemy" && e["target"] !== "allEnemies") {
        this.fail(`${f}.target`, 'must be "self", "enemy" or "allEnemies"');
      }
      switch (e["type"]) {
        case "damage":
          if (e["damageType"] !== "physical" && e["damageType"] !== "arcane") this.fail(`${f}.damageType`, 'must be "physical" or "arcane"');
          this.num(e, "amount", { min: 0 });
          this.scaling(e["scaling"], `${f}.scaling`);
          this.hits(e, `${f}.hits`);
          break;
        case "heal":
        case "restoreShield":
          this.num(e, "amount", { min: 0 });
          this.scaling(e["scaling"], `${f}.scaling`);
          this.userOnlyScaling(e["scaling"], `${f}.scaling`);
          break;
        case "status":
          if (!(STATUS_IDS as readonly unknown[]).includes(e["status"])) this.fail(`${f}.status`, "unknown status id");
          this.num(e, "stacks", { min: 1, integer: true });
          if (e["chance"] !== undefined && (!isNum(e["chance"]) || e["chance"] <= 0 || e["chance"] > 1)) this.fail(`${f}.chance`, "must be in (0, 1]");
          break;
        case "consume":
          if (!(STATUS_IDS as readonly unknown[]).includes(e["status"])) this.fail(`${f}.status`, "unknown status id");
          if (!isNum(e["multiplier"]) || e["multiplier"] < 0) this.fail(`${f}.multiplier`, "must be a number >= 0");
          if (e["damageType"] !== "physical" && e["damageType"] !== "arcane") this.fail(`${f}.damageType`, 'must be "physical" or "arcane"');
          if (e["max"] !== undefined && (!isNum(e["max"]) || !Number.isInteger(e["max"]) || e["max"] < 1)) this.fail(`${f}.max`, "must be a positive integer");
          break;
        default:
          this.fail(`${f}.type`, "unknown effect type");
      }
    });
  }
}

function checkSkillFields(c: Checker, d: Obj): void {
  c.tags(d);
  // Spec: only Strike has no cooldown, and Strike lives on the weapon, not here.
  c.num(d, "cooldown", { min: 1, integer: true });
  c.effects(d);
}

function checkDef(file: ContentFile): { def?: ContentDef; issues: ValidationIssue[] } {
  const c = new Checker(file.path);
  const d = file.data;
  if (!isObj(d)) {
    c.fail("", "file must contain a JSON object");
    return { issues: c.issues };
  }
  const kind = d["kind"] as ContentKind;
  if (!(kind in KIND_PREFIX)) {
    c.fail("kind", `unknown kind "${String(d["kind"])}"`);
    return { issues: c.issues };
  }
  c.str(d, "id");
  c.str(d, "name");
  if (isStr(d["id"])) {
    if (!ID_PATTERN.test(d["id"])) c.fail("id", 'must look like "prefix.snake_case"');
    else if (!d["id"].startsWith(`${KIND_PREFIX[kind]}.`)) c.fail("id", `must start with "${KIND_PREFIX[kind]}."`);
  }

  switch (kind) {
    case "character": {
      const fav = d["favoured"];
      if (!Array.isArray(fav) || fav.length < 1 || fav.length > 3 || !fav.every(isStatId)) c.fail("favoured", "must list 1 to 3 stat ids");
      else if (new Set(fav).size !== fav.length) c.fail("favoured", "must not repeat a stat");
      if (!Array.isArray(d["eventTags"]) || !d["eventTags"].every(isStr)) c.fail("eventTags", "must be an array of strings");
      break;
    }
    case "weapon": {
      c.stats(d, "stats");
      c.powers(d);
      c.traits(d);
      c.num(d, "hp", { min: 0, optional: true, integer: true });
      c.num(d, "shield", { min: 0, optional: true, integer: true });
      const a = d["attack"];
      if (!isObj(a)) c.fail("attack", "weapons must define their Strike as { damage, damageType, scaling }");
      else {
        c.num(a, "damage", { min: 0 });
        if (a["damageType"] !== "physical" && a["damageType"] !== "arcane") c.fail("attack.damageType", 'must be "physical" or "arcane"');
        c.scaling(a["scaling"], "attack.scaling");
        c.hits(a, "attack.hits");
      }
      break;
    }
    case "armor":
    case "accessory":
      c.stats(d, "stats");
      c.powers(d);
      c.traits(d);
      c.num(d, "hp", { min: 0, optional: true, integer: true });
      c.num(d, "shield", { min: 0, optional: true, integer: true });
      if (kind === "accessory" && d["grants"] !== undefined && !isStr(d["grants"])) c.fail("grants", "must be a skill or word id");
      break;
    case "path":
      c.stats(d, "stats");
      c.powers(d);
      c.traits(d);
      // Only items give HP and Shield (spec: Loadout assembly, Details).
      if (d["hp"] !== undefined) c.fail("hp", "paths don't give HP; only items do");
      if (d["shield"] !== undefined) c.fail("shield", "paths don't give Shield; only items do");
      break;
    case "word":
      // A Word is a skill with a glyph, a spoken form and a meaning.
      c.str(d, "glyph");
      c.str(d, "spoken");
      c.str(d, "meaning");
      checkSkillFields(c, d);
      break;
    case "skill":
      checkSkillFields(c, d);
      break;
    case "act":
      checkAct(c, d);
      break;
  }
  return c.issues.length === 0 ? { def: d as unknown as ContentDef, issues: [] } : { issues: c.issues };
}

/** Validate every file of a pack, then cross-references between them. */
export function validatePack(packId: string, files: readonly ContentFile[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  const byId = new Map<string, ContentDef>();
  const fileOf = new Map<string, string>();

  for (const file of files) {
    const res = checkDef(file);
    issues.push(...res.issues);
    if (!res.def) continue;
    const prev = fileOf.get(res.def.id);
    if (prev) issues.push({ path: `${file.path}#id`, message: `duplicate id, already defined in ${prev}` });
    byId.set(res.def.id, res.def);
    fileOf.set(res.def.id, file.path);
  }

  const isSkillLike = (id: string) => {
    const def = byId.get(id);
    return def?.kind === "skill" || def?.kind === "word";
  };
  for (const def of byId.values()) {
    const where = fileOf.get(def.id) ?? def.id;
    if (def.kind === "accessory" && def.grants !== undefined && !isSkillLike(def.grants)) {
      issues.push({ path: `${where}#grants`, message: `"${def.grants}" is not a skill or word in this pack` });
    }
    if ((def.kind === "skill" || def.kind === "word") && def.upgrade !== undefined && !isSkillLike(def.upgrade)) {
      issues.push({ path: `${where}#upgrade`, message: `"${def.upgrade}" is not a skill or word in this pack` });
    }
    if (def.kind === "act") {
      (def.routes ?? []).forEach((r, i) => {
        if (byId.get(r.to)?.kind !== "act") issues.push({ path: `${where}#routes[${i}].to`, message: `"${r.to}" is not an act in this pack` });
      });
    }
  }

  // At most one act a run starts in (spec: Run map). A pack with none is checked by the run engine.
  const firsts = [...byId.values()].filter((def) => def.kind === "act" && def.first === true);
  for (const def of firsts.slice(1)) {
    issues.push({ path: `${fileOf.get(def.id) ?? def.id}#first`, message: `only one act per pack may be first; "${firsts[0]?.id ?? ""}" already is` });
  }

  return issues.length === 0 ? { issues, pack: { id: packId, byId } } : { issues };
}
