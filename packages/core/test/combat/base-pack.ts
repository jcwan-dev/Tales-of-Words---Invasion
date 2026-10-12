// The base content pack as ContentFiles, for tests that use real content (not a test file itself).
// Imported statically because the core tests run without Node APIs. Add new base files here.
import { validatePack, type ContentFile, type ContentPack, type SkillDef, type WeaponDef, type WordDef } from "../../src/index.ts";
import f1 from "../../../../content/base/accessories/ember_charm.json" with { type: "json" };
import f2 from "../../../../content/base/accessories/iron_locket.json" with { type: "json" };
import f3 from "../../../../content/base/accessories/lodestone_ring.json" with { type: "json" };
import f4 from "../../../../content/base/armor/riveted_brigandine.json" with { type: "json" };
import f5 from "../../../../content/base/armor/ward_stitched_robe.json" with { type: "json" };
import f6 from "../../../../content/base/characters/scholar.json" with { type: "json" };
import f7 from "../../../../content/base/characters/sellsword.json" with { type: "json" };
import f8 from "../../../../content/base/characters/urchin.json" with { type: "json" };
import f9 from "../../../../content/base/paths/sworn_road.json" with { type: "json" };
import f10 from "../../../../content/base/skills/bloodletter.json" with { type: "json" };
import f11 from "../../../../content/base/skills/cleave.json" with { type: "json" };
import f12 from "../../../../content/base/skills/dirty_trick.json" with { type: "json" };
import f13 from "../../../../content/base/skills/mend.json" with { type: "json" };
import f14 from "../../../../content/base/skills/shore_up.json" with { type: "json" };
import f15 from "../../../../content/base/weapons/ashwood_staff.json" with { type: "json" };
import f16 from "../../../../content/base/weapons/notched_longsword.json" with { type: "json" };
import f17 from "../../../../content/base/weapons/twin_knives.json" with { type: "json" };
import f18 from "../../../../content/base/words/bing.json" with { type: "json" };
import f19 from "../../../../content/base/words/dun.json" with { type: "json" };
import f20 from "../../../../content/base/words/huo.json" with { type: "json" };
import f21 from "../../../../content/base/words/lei.json" with { type: "json" };
import f22 from "../../../../content/base/words/yu.json" with { type: "json" };
import f23 from "../../../../content/base/acts/act1_drowned_marches/act.json" with { type: "json" };

export const BASE_FILES: readonly ContentFile[] = [
  { path: "base/accessories/ember_charm.json", data: f1 },
  { path: "base/accessories/iron_locket.json", data: f2 },
  { path: "base/accessories/lodestone_ring.json", data: f3 },
  { path: "base/armor/riveted_brigandine.json", data: f4 },
  { path: "base/armor/ward_stitched_robe.json", data: f5 },
  { path: "base/characters/scholar.json", data: f6 },
  { path: "base/characters/sellsword.json", data: f7 },
  { path: "base/characters/urchin.json", data: f8 },
  { path: "base/paths/sworn_road.json", data: f9 },
  { path: "base/skills/bloodletter.json", data: f10 },
  { path: "base/skills/cleave.json", data: f11 },
  { path: "base/skills/dirty_trick.json", data: f12 },
  { path: "base/skills/mend.json", data: f13 },
  { path: "base/skills/shore_up.json", data: f14 },
  { path: "base/weapons/ashwood_staff.json", data: f15 },
  { path: "base/weapons/notched_longsword.json", data: f16 },
  { path: "base/weapons/twin_knives.json", data: f17 },
  { path: "base/words/bing.json", data: f18 },
  { path: "base/words/dun.json", data: f19 },
  { path: "base/words/huo.json", data: f20 },
  { path: "base/words/lei.json", data: f21 },
  { path: "base/words/yu.json", data: f22 },
  { path: "base/acts/act1_drowned_marches/act.json", data: f23 },
];

/** The validated base pack; throws with the issues if it doesn't validate. */
export function basePack(): ContentPack {
  const res = validatePack("base", BASE_FILES);
  if (!res.pack) throw new Error(`base pack invalid:\n${res.issues.map((i) => `${i.path} ${i.message}`).join("\n")}`);
  return res.pack;
}

export function weaponDef(id: string): WeaponDef {
  const def = basePack().byId.get(id);
  if (def?.kind !== "weapon") throw new Error(`${id} is not a weapon in the base pack`);
  return def;
}

export function skillDef(id: string): SkillDef | WordDef {
  const def = basePack().byId.get(id);
  if (def?.kind !== "skill" && def?.kind !== "word") throw new Error(`${id} is not a skill or word in the base pack`);
  return def;
}
