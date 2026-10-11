import { describe, expect, it } from "vitest";
import { validatePack } from "../src/index.ts";

// Builder unit tests: the validator accepts the three Scaling shapes (spec 1.5, Synergy effects) and
// rejects anything else.
const skill = (scaling: unknown) => ({
  path: "s.json",
  data: { kind: "skill", id: "skill.fester", name: "n", cost: 1, cooldown: 1, effects: [{ type: "damage", damageType: "physical", amount: 0, target: "enemy", scaling }] },
});
const issuesFor = (scaling: unknown) => validatePack("test", [skill(scaling)]).issues.map((i) => i.path);

describe("content validation: scaling shapes", () => {
  it("accepts { stat, per }, { afflictions: true, per } and { stacksOfTag, per }", () => {
    expect(issuesFor([{ stat: "might", per: 2 }, { afflictions: true, per: 4 }, { stacksOfTag: "dot", per: 1 }])).toEqual([]);
  });

  it("rejects an unknown stat or tag, and afflictions other than true", () => {
    expect(issuesFor([{ stat: "charisma", per: 1 }])).toEqual(["s.json#effects[0].scaling[0].stat"]);
    expect(issuesFor([{ stacksOfTag: "curse", per: 1 }])).toEqual(["s.json#effects[0].scaling[0].stacksOfTag"]);
    expect(issuesFor([{ afflictions: 1, per: 1 }])).toEqual(["s.json#effects[0].scaling[0].afflictions"]);
  });

  it("rejects a term with no kind, two kinds, or no numeric per", () => {
    expect(issuesFor([{ per: 1 }])).toEqual(["s.json#effects[0].scaling[0]"]);
    expect(issuesFor([{ stat: "might", afflictions: true, per: 1 }])).toEqual(["s.json#effects[0].scaling[0]"]);
    expect(issuesFor([{ stat: "might" }])).toEqual(["s.json#effects[0].scaling[0]"]);
  });
});
