# ADR 0010: Run engine and node modules (`run/run`, `nodes/`)

- Status: accepted
- Date: 2026-10-12

## Context
Spec 1.9 ("Run map") defines how a run moves through an act: a step count rolled per act, 3 options drawn at each step from weighted node types, fixed nodes (mid-act event, boss), node results, falling and reviving, and routes between acts. Events, fights and shops arrive as separate modules in later M2 steps, so the engine must not know what a node type is. Runs must pause and resume at any node. Code rule 10 asks for an ADR for a new module type.

## Decision
- **New module type: node types.** `packages/core/src/nodes/` defines `NodeType` (`id`, `mayFollowItself`, `canAppear(run, act)`, `build({ run, act, ref, rng })`) and a `NodeRegistry` (by id, RangeError on a duplicate). The registry is passed to every command in a `RunContext` with the content pack. Behaviour comes from the module, never from the type id: "no merchant after a merchant" is the merchant's `mayFollowItself: false`.
- **Content kind `act`** (`act.<name>`): `steps`, `weights`, `fixed`, `routes`, `first`, checked by content validation (route targets, at most one first act). Validation doesn't know the modules; `startRun` throws RangeError when any act of the pack names a type with no module.
- **Run state is plain data** (`RunState`), mutated in place by commands (`startRun`, `chooseOption`, `completeNode`, `chooseRoute`, `revive`, `endRun`) that return a list of events or a refusal reason. A refused command changes nothing. Options are built when offered and stored whole (`text`, `tag`, JSON `data`), so a node restarted after a resume is the same node.
- **Randomness:** stateless derived streams, `derive("map", actNumber, act, "steps")`, `derive("map", actNumber, act, step)` and `derive("node", actNumber, act, step, option)`. Nothing is carried between decisions, so no RNG state is saved and an act visited twice draws afresh.
- **Node results** carry HP, crowns and flags for now; the engine clamps HP, refuses crowns below 0 and non-integers, and applies set before clear. Revives go through `consume()` in `run/limits.ts`.
- The draw itself (`drawOptionTypes`, `pickWeighted` in `run/draw.ts`) is a pure function of the drawable types and an rng.

## Consequences
- Event, combat and merchant modules plug in by registering a `NodeType`; the engine doesn't change. A node's in-progress state (a fight, an Ink story position) stays out of `RunState`.
- Node results will grow (rewards, learning) as new optional fields.
- A content bug where no type can be drawn throws `Error` at that step rather than skipping it.
