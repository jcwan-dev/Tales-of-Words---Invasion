import { describe, expect, it } from "vitest";
import { validatePack, type ContentFile, type ValidationResult } from "../src/index.ts";

// Spec Draft 1.9, "Run map", act.json (content kind `act`, id `act.<name>`); brief M2.2, "Content and validation":
//   name string; steps integers 2 ≤ min ≤ max; weights object of non-negative integers, at least one > 0, keys
//   non-empty; fixed array: `at` integer 1..min−1 or "last", exactly one "last", no two on the same step, `type`
//   non-empty string, `ref` optional non-empty string; routes optional: `to` an act id in the pack, flags/notFlags
//   arrays of non-empty strings, and if routes exist at least one has no flags and no notFlags; first optional
//   boolean; at most one act with first: true per pack.
// Content validation doesn't know the node modules: any type id is accepted here.

type Obj = Record<string, unknown>;

const act = (id: string, over: Obj = {}, path = `${id}.json`): ContentFile => {
  const merged: Obj = {
    kind: "act",
    id,
    name: `${id}.name`,
    steps: { min: 3, max: 5 },
    weights: { event: 50, combat: 35, merchant: 15 },
    fixed: [{ at: "last", type: "combat", ref: "group.boss" }],
    ...over,
  };
  const data: Obj = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined));
  return { path, data };
};

const check = (...files: ContentFile[]): ValidationResult => validatePack("test", files);

/** One file, path "a.json". */
const one = (over: Obj): ValidationResult => check(act("act.one", over, "a.json"));

const fieldIssues = (res: ValidationResult, file: string, field: string): string[] =>
  res.issues.filter((i) => i.path.startsWith(`${file}#${field}`)).map((i) => `${i.path} ${i.message}`);

function expectValid(res: ValidationResult): void {
  expect(res.issues).toEqual([]);
  expect(res.pack).toBeDefined();
}

function expectIssue(res: ValidationResult, file: string, field: string): void {
  expect(fieldIssues(res, file, field).length).toBeGreaterThan(0);
  expect(res.pack).toBeUndefined();
}

describe("act validation: the basics", () => {
  it("accepts a valid act and puts it in the pack", () => {
    const res = one({ first: true });
    expectValid(res);
    expect(res.pack?.byId.get("act.one")).toMatchObject({ kind: "act", id: "act.one", steps: { min: 3, max: 5 }, first: true });
  });

  it("accepts an act with fixed mid-act nodes, refs, routes and first: false", () => {
    expectValid(
      check(
        act("act.one", {
          first: true,
          fixed: [{ at: 2, type: "event", ref: "event.crossroads" }, { at: 1, type: "merchant" }, { at: "last", type: "combat", ref: "group.boss" }],
          routes: [{ to: "act.two", flags: ["saved_town"] }, { to: "act.three", notFlags: ["saved_town"] }, { to: "act.three" }],
        }),
        act("act.two", { first: false }),
        act("act.three"),
      ),
    );
  });

  it("requires the id prefix act.", () => {
    expectIssue(check(act("stage.one", {}, "a.json")), "a.json", "id");
  });

  it("requires a name", () => {
    expectIssue(one({ name: undefined }), "a.json", "name");
    expectIssue(one({ name: "" }), "a.json", "name");
  });
});

describe("act validation: steps", () => {
  it("accepts min 2 (the smallest) and min equal to max", () => {
    expectValid(one({ steps: { min: 2, max: 2 } }));
    expectValid(one({ steps: { min: 4, max: 4 } }));
  });

  it.each([
    [undefined],
    [{ min: 1, max: 4 }],
    [{ min: 0, max: 4 }],
    [{ min: 5, max: 4 }],
    [{ min: 2.5, max: 4 }],
    [{ min: 3, max: 4.5 }],
    [{ min: "3", max: 4 }],
    [{ min: 3 }],
    [[3, 4]],
  ])("rejects steps that aren't integers with 2 ≤ min ≤ max %#", (steps) => {
    expectIssue(one({ steps }), "a.json", "steps");
  });
});

describe("act validation: weights", () => {
  it("accepts zero weights next to a positive one, and any type id", () => {
    expectValid(one({ weights: { event: 1, combat: 0, merchant: 0, shrine: 3 } }));
  });

  it.each([
    [undefined],
    [{}],
    [{ event: 0, combat: 0 }],
    [{ event: -1, combat: 5 }],
    [{ event: 1.5 }],
    [{ event: "5" }],
    [{ "": 5 }],
    [[5, 3]],
  ])("rejects weights that aren't non-negative integers with at least one above 0 and non-empty keys %#", (weights) => {
    expectIssue(one({ weights }), "a.json", "weights");
  });
});

describe("act validation: fixed nodes", () => {
  const boss = { at: "last", type: "combat", ref: "group.boss" };

  it("accepts at from 1 to min − 1", () => {
    expectValid(one({ steps: { min: 4, max: 6 }, fixed: [{ at: 1, type: "event" }, { at: 3, type: "event" }, boss] }));
  });

  it("accepts a fixed node without ref", () => {
    expectValid(one({ fixed: [{ at: "last", type: "combat" }] }));
  });

  it("requires fixed", () => {
    expectIssue(one({ fixed: undefined }), "a.json", "fixed");
  });

  it.each([
    [{ at: 0, type: "event" }],
    [{ at: 3, type: "event" }], // min is 3: at must be ≤ 2
    [{ at: 4, type: "event" }],
    [{ at: 1.5, type: "event" }],
    [{ at: "first", type: "event" }],
    [{ at: "2", type: "event" }],
    [{ type: "event" }],
  ])("rejects an at that isn't an integer from 1 to min − 1 or \"last\" %#", (node) => {
    expectIssue(one({ fixed: [node, boss] }), "a.json", "fixed");
  });

  it("rejects an act with no \"last\" fixed node", () => {
    expectIssue(one({ fixed: [{ at: 1, type: "event" }] }), "a.json", "fixed");
    expectIssue(one({ fixed: [] }), "a.json", "fixed");
  });

  it("rejects two \"last\" fixed nodes", () => {
    expectIssue(one({ fixed: [boss, { at: "last", type: "combat", ref: "group.other" }] }), "a.json", "fixed");
  });

  it("rejects two fixed nodes on the same step", () => {
    expectIssue(one({ fixed: [{ at: 2, type: "event" }, { at: 2, type: "merchant" }, boss] }), "a.json", "fixed");
  });

  it("rejects an empty or missing type", () => {
    expectIssue(one({ fixed: [{ at: "last", type: "" }] }), "a.json", "fixed");
    expectIssue(one({ fixed: [{ at: "last" }] }), "a.json", "fixed");
  });

  it("rejects an empty or non-string ref", () => {
    expectIssue(one({ fixed: [{ at: "last", type: "combat", ref: "" }] }), "a.json", "fixed");
    expectIssue(one({ fixed: [{ at: "last", type: "combat", ref: 7 }] }), "a.json", "fixed");
  });

  it("rejects fixed that isn't an array", () => {
    expectIssue(one({ fixed: { at: "last", type: "combat" } }), "a.json", "fixed");
  });
});

describe("act validation: routes", () => {
  it("accepts an act without routes (the run is won after its boss)", () => {
    expectValid(one({ routes: undefined }));
  });

  it("accepts routes: [] (the same as no routes)", () => {
    expectValid(one({ routes: [] }));
  });

  it("accepts empty flags and notFlags as the unconditioned route", () => {
    expectValid(
      check(
        act("act.one", { routes: [{ to: "act.two", flags: ["x"] }, { to: "act.three", flags: [], notFlags: [] }] }),
        act("act.two"),
        act("act.three"),
      ),
    );
    expectValid(check(act("act.one", { routes: [{ to: "act.two", flags: [] }] }), act("act.two")));
  });

  it("accepts a route back to the same act (a loop)", () => {
    expectValid(one({ routes: [{ to: "act.one" }] }));
  });

  it("rejects a route to an id that isn't in the pack", () => {
    expectIssue(check(act("act.one", { routes: [{ to: "act.missing" }] }, "a.json")), "a.json", "routes");
  });

  it("rejects a route to something that isn't an act", () => {
    const skill: ContentFile = {
      path: "s.json",
      data: { kind: "skill", id: "skill.x", name: "n", cooldown: 1, effects: [{ type: "heal", amount: 1, target: "self" }] },
    };
    expectIssue(check(act("act.one", { routes: [{ to: "skill.x" }] }, "a.json"), skill), "a.json", "routes");
  });

  it("rejects a route without to", () => {
    expectIssue(check(act("act.one", { routes: [{ flags: ["x"] }, {}] }, "a.json")), "a.json", "routes");
  });

  it.each([
    [{ to: "act.two", flags: "x" }],
    [{ to: "act.two", flags: [""] }],
    [{ to: "act.two", flags: [3] }],
    [{ to: "act.two", notFlags: "x" }],
    [{ to: "act.two", notFlags: [""] }],
  ])("rejects flags or notFlags that aren't arrays of non-empty strings %#", (route) => {
    expectIssue(check(act("act.one", { routes: [route, { to: "act.two" }] }, "a.json"), act("act.two")), "a.json", "routes");
  });

  it("rejects routes where every route has conditions (no route always open)", () => {
    const res = check(
      act("act.one", { routes: [{ to: "act.two", flags: ["x"] }, { to: "act.three", notFlags: ["x"] }] }, "a.json"),
      act("act.two"),
      act("act.three"),
    );
    expectIssue(res, "a.json", "routes");
  });

  it("accepts conditional routes when one route has no flags and no notFlags", () => {
    expectValid(check(act("act.one", { routes: [{ to: "act.two", flags: ["x"] }, { to: "act.three" }] }), act("act.two"), act("act.three")));
  });

  it("rejects routes that isn't an array", () => {
    expectIssue(check(act("act.one", { routes: { to: "act.two" } }, "a.json"), act("act.two")), "a.json", "routes");
  });
});

describe("act validation: first", () => {
  it("rejects a first that isn't a boolean", () => {
    expectIssue(one({ first: "yes" }), "a.json", "first");
    expectIssue(one({ first: 1 }), "a.json", "first");
  });

  it("rejects two acts marked first in one pack", () => {
    const res = check(act("act.one", { first: true }, "a.json"), act("act.two", { first: true }, "b.json"));
    expect(res.issues.some((i) => i.path.includes("#first"))).toBe(true);
    expect(res.pack).toBeUndefined();
  });

  it("accepts one act marked first among several, and a pack with none (the run engine checks that)", () => {
    expectValid(check(act("act.one", { first: true }), act("act.two"), act("act.three", { first: false })));
    expectValid(check(act("act.one"), act("act.two")));
  });
});
