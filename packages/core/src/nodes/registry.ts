import type { NodeType } from "./types.ts";

/** The node types a run can use, by id. Built once by the app (or a test) and passed in the run context. */
export class NodeRegistry {
  readonly #types = new Map<string, NodeType>();

  /** Adds a type. Throws RangeError if a type with the same id is already registered. */
  register(type: NodeType): void {
    if (this.#types.has(type.id)) throw new RangeError(`node registry: type "${type.id}" is already registered`);
    this.#types.set(type.id, type);
  }

  get(id: string): NodeType | undefined {
    return this.#types.get(id);
  }

  has(id: string): boolean {
    return this.#types.has(id);
  }
}
