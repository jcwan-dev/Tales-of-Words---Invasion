import { describe, expect, it } from "vitest";
import { CardCooldowns } from "../../../src/index.ts";

describe("CardCooldowns (builder unit tests)", () => {
  it("unknown cards are ready", () => {
    const c = new CardCooldowns();
    expect(c.remaining("x")).toBe(0);
    expect(c.ready("x")).toBe(true);
    c.tick();
    expect(c.remaining("x")).toBe(0);
  });

  it("the first tick after start is skipped (use turn), then 1 per tick down to 0", () => {
    const c = new CardCooldowns();
    c.start("a", 2);
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      c.tick();
      seen.push(c.remaining("a"));
    }
    expect(seen).toEqual([2, 1, 0, 0]);
  });

  it("restarting a card resets its counter and spares it again", () => {
    const c = new CardCooldowns();
    c.start("a", 1);
    c.tick();
    c.tick();
    expect(c.ready("a")).toBe(true);
    c.start("a", 3);
    c.tick();
    expect(c.remaining("a")).toBe(3);
  });

  it("cards are independent; non-positive turns set nothing", () => {
    const c = new CardCooldowns();
    c.start("a", 2);
    c.tick(); // a spared
    c.start("b", 1);
    c.start("z", 0);
    c.start("y", -1);
    c.tick(); // a 2 -> 1, b spared
    expect(c.remaining("a")).toBe(1);
    expect(c.remaining("b")).toBe(1);
    expect(c.remaining("z")).toBe(0);
    expect(c.remaining("y")).toBe(0);
  });
});
