/**
 * Content validation (spec: Testing strategy, "Content validation").
 * Hand-written so the core keeps zero runtime dependencies. Runs in CI over
 * every content pack, and at load time in development builds.
 */
import { isStatId, STAT_IDS } from "../model/stats.ts";
import { STATUS_IDS, type ContentDef, type ContentKind, type ContentPack } from "./types.ts";

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
};

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
    v.forEach((s, i) => {
      if (!isObj(s) || !isStatId(s["stat"]) || !isNum(s["per"])) this.fail(`${field}[${i}]`, "must be { stat, per }");
    });
  }
  effects(o: Obj): void {
    const list = o["effects"];
    if (!Array.isArray(list) || list.length === 0) return this.fail("effects", "must be a non-empty array");
    list.forEach((e, i) => {
      const f = `effects[${i}]`;
      if (!isObj(e)) return this.fail(f, "must be an object");
      if (e["target"] !== "self" && e["target"] !== "enemy") this.fail(`${f}.target`, 'must be "self" or "enemy"');
      switch (e["type"]) {
        case "damage":
          if (e["damageType"] !== "physical" && e["damageType"] !== "arcane") this.fail(`${f}.damageType`, 'must be "physical" or "arcane"');
          this.num(e, "amount", { min: 0 });
          this.scaling(e["scaling"], `${f}.scaling`);
          break;
        case "heal":
        case "restoreShield":
          this.num(e, "amount", { min: 0 });
          this.scaling(e["scaling"], `${f}.scaling`);
          break;
        case "status":
          if (!(STATUS_IDS as readonly unknown[]).includes(e["status"])) this.fail(`${f}.status`, "unknown status id");
          this.num(e, "stacks", { min: 1, integer: true });
          if (e["chance"] !== undefined && (!isNum(e["chance"]) || e["chance"] <= 0 || e["chance"] > 1)) this.fail(`${f}.chance`, "must be in (0, 1]");
          break;
        default:
          this.fail(`${f}.type`, "unknown effect type");
      }
    });
  }
}

function checkSkillFields(c: Checker, d: Obj): void {
  c.num(d, "cost", { min: 0, integer: true });
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
      c.num(d, "hp", { min: 0, optional: true, integer: true });
      c.num(d, "shield", { min: 0, optional: true, integer: true });
      const a = d["attack"];
      if (!isObj(a)) c.fail("attack", "weapons must define their Strike as { damage, damageType, scaling }");
      else {
        c.num(a, "damage", { min: 0 });
        if (a["damageType"] !== "physical" && a["damageType"] !== "arcane") c.fail("attack.damageType", 'must be "physical" or "arcane"');
        c.scaling(a["scaling"], "attack.scaling");
      }
      break;
    }
    case "armor":
    case "accessory":
      c.stats(d, "stats");
      c.num(d, "hp", { min: 0, optional: true, integer: true });
      c.num(d, "shield", { min: 0, optional: true, integer: true });
      if (kind === "accessory" && d["grants"] !== undefined && !isStr(d["grants"])) c.fail("grants", "must be a skill or word id");
      break;
    case "path":
      c.stats(d, "stats");
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
  }

  return issues.length === 0 ? { issues, pack: { id: packId, byId } } : { issues };
}
