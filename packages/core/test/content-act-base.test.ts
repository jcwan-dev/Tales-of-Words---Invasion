import { describe, expect, it } from "vitest";
import { validatePack, type ContentFile } from "../src/index.ts";
import { BASE_FILES } from "./combat/base-pack.ts";
import actOne from "../../../content/base/acts/act1_drowned_marches/act.json" with { type: "json" };

// Brief M2.2: Act I's act.json: id act.drowned_marches, name act.drowned_marches.name, first true, steps 10–14
// (spec "Core loop": 10–14 steps per act), weights event 50 / combat 35 / merchant 15, fixed the mid-act event
// {at 6, event, event.act1_crossroads} and the boss {at "last", combat, group.act1_boss}, no routes (placeholders).

const ACT_FILE: ContentFile = { path: "base/acts/act1_drowned_marches/act.json", data: actOne };

describe("base pack: Act I (The Drowned Marches)", () => {
  it("validates with the rest of the base pack", () => {
    const files = BASE_FILES.some((f) => f.path === ACT_FILE.path) ? BASE_FILES : [...BASE_FILES, ACT_FILE];
    const res = validatePack("base", files);
    expect(res.issues).toEqual([]);
    expect(res.pack?.byId.get("act.drowned_marches")?.kind).toBe("act");
  });

  it("matches the brief's placeholder numbers", () => {
    expect(actOne).toMatchObject({
      kind: "act",
      id: "act.drowned_marches",
      name: "act.drowned_marches.name",
      first: true,
      steps: { min: 10, max: 14 },
      weights: { event: 50, combat: 35, merchant: 15 },
    });
    expect(actOne.fixed).toEqual(
      expect.arrayContaining([
        { at: 6, type: "event", ref: "event.act1_crossroads" },
        { at: "last", type: "combat", ref: "group.act1_boss" },
      ]),
    );
    expect(actOne.fixed).toHaveLength(2);
    expect((actOne as { routes?: unknown }).routes).toBeUndefined();
  });
});
