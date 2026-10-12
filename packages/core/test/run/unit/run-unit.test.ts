import { describe, expect, it } from "vitest";
import { chooseOption, completeNode, createRng, drawOptionTypes, NodeRegistry, pickWeighted, type NodeType } from "../../../src/index.ts";
import { ctxOf, start } from "../run-pack.ts";

// Builder unit tests for run/draw, nodes/registry and run/run internals.

describe("pickWeighted", () => {
  it("never picks a type outside the list and follows the weights", () => {
    const rng = createRng("w");
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const t = pickWeighted(rng, [
        { type: "a", weight: 1 },
        { type: "b", weight: 3 },
      ]);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(["a", "b"]);
    expect(Math.abs((counts.get("b") ?? 0) / 4000 - 0.75)).toBeLessThan(0.03);
  });

  it("throws RangeError for an empty list or zero total weight", () => {
    expect(() => pickWeighted(createRng("x"), [])).toThrow(RangeError);
    expect(() => pickWeighted(createRng("x"), [{ type: "a", weight: 0 }])).toThrow(RangeError);
  });

  it("draws exactly one number from the rng", () => {
    const a = createRng("one");
    const b = createRng("one");
    pickWeighted(a, [{ type: "a", weight: 5 }]);
    b.next();
    expect(a.state()).toEqual(b.state());
  });
});

describe("drawOptionTypes", () => {
  it("returns three of the one type when it is the only one", () => {
    expect(drawOptionTypes(createRng("s"), [{ type: "a", weight: 2 }])).toEqual(["a", "a", "a"]);
  });

  it("always shows two types when two can be drawn", () => {
    for (let i = 0; i < 300; i++) {
      const types = drawOptionTypes(createRng(`s${i}`), [
        { type: "a", weight: 999 },
        { type: "b", weight: 1 },
      ]);
      expect(new Set(types).size).toBe(2);
    }
  });

  it("is deterministic for a given rng seed", () => {
    const items = [
      { type: "a", weight: 2 },
      { type: "b", weight: 2 },
      { type: "c", weight: 1 },
    ];
    expect(drawOptionTypes(createRng("d"), items)).toEqual(drawOptionTypes(createRng("d"), items));
  });
});

describe("NodeRegistry", () => {
  const type = (id: string): NodeType => ({
    id,
    mayFollowItself: true,
    canAppear: () => true,
    build: () => ({ text: "t", tag: null, data: null }),
  });

  it("has() reports registered ids", () => {
    const r = new NodeRegistry();
    r.register(type("a"));
    expect(r.has("a")).toBe(true);
    expect(r.has("b")).toBe(false);
  });

  it("keeps the first type when a duplicate is refused", () => {
    const r = new NodeRegistry();
    const first = type("a");
    r.register(first);
    expect(() => r.register(type("a"))).toThrow(RangeError);
    expect(r.get("a")).toBe(first);
  });
});

describe("run engine", () => {
  it("a resumed run still needs its node modules: offering the next step with a missing type throws RangeError", () => {
    const ctx = ctxOf();
    const { run } = start(ctx, "resume");
    const bare = { pack: ctx.pack, registry: new NodeRegistry() };
    expect(chooseOption(bare, run, 0).ok).toBe(true); // entering needs no module: the option is already built
    expect(() => completeNode(bare, run, {})).toThrow(RangeError);
  });

  it("events don't share arrays with the run state", () => {
    const ctx = ctxOf();
    const { run, events } = start(ctx, "share");
    const offered = events[2];
    run.offer.length = 0;
    expect(offered?.type === "OptionsOffered" ? offered.options : []).toHaveLength(3);
  });
});
