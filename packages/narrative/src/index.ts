/**
 * Narrative layer contract (spec: Nodes → Events). Implemented with inkjs in M2.
 *
 * The core passes run state in as Ink variables (stats, character tags,
 * companion, path, flags); Ink returns the visible choices and, once one is
 * picked, a list of effects the core applies. Ink never mutates game state
 * directly, so events stay deterministic and testable.
 */
import type { StatId } from "@tow/core";

export interface NarrativeContext {
  readonly stats: Readonly<Record<StatId, number>>;
  readonly tags: readonly string[];
  readonly companion: string | null;
  readonly path: string;
  readonly flags: ReadonlySet<string>;
}

export interface NarrativeChoice {
  readonly index: number;
  /** Localised text of the choice. */
  readonly text: string;
  /** Requirement label shown above the choice, e.g. "Intelligence 3" or "Mara is with you". */
  readonly requirement?: string;
  /** Locked choices stay visible so players know there is more to find. */
  readonly locked: boolean;
}

export type NarrativeEffect =
  | { readonly type: "hp"; readonly amount: number }
  | { readonly type: "gold"; readonly amount: number }
  | { readonly type: "flag"; readonly flag: string }
  | { readonly type: "learn"; readonly skill: string }
  | { readonly type: "companionJoins"; readonly companion: string };

export interface NarrativeEvent {
  /** Paragraphs of story text for the current passage. */
  readonly text: readonly string[];
  readonly choices: readonly NarrativeChoice[];
  readonly ended: boolean;
}

export interface NarrativeAdapter {
  start(eventId: string, context: NarrativeContext): NarrativeEvent;
  choose(index: number): { readonly event: NarrativeEvent; readonly effects: readonly NarrativeEffect[] };
}
