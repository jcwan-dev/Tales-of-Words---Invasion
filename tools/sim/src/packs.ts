import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContentFile } from "@tow/core";

export const CONTENT_ROOT = resolve(fileURLToPath(new URL("../../../content", import.meta.url)));

/** Content packs are the folders under content/ that contain a pack.json. */
export function listPacks(): string[] {
  return readdirSync(CONTENT_ROOT).filter((name) => {
    const dir = join(CONTENT_ROOT, name);
    return statSync(dir).isDirectory() && safeIsFile(join(dir, "pack.json"));
  });
}

function safeIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".json") && name !== "pack.json") out.push(full);
  }
  return out;
}

export interface LoadedFiles {
  readonly files: ContentFile[];
  readonly parseErrors: { path: string; message: string }[];
}

export function loadPackFiles(pack: string): LoadedFiles {
  const dir = join(CONTENT_ROOT, pack);
  const files: ContentFile[] = [];
  const parseErrors: { path: string; message: string }[] = [];
  for (const full of walk(dir).sort()) {
    const path = relative(CONTENT_ROOT, full);
    try {
      files.push({ path, data: JSON.parse(readFileSync(full, "utf8")) as unknown });
    } catch (e) {
      parseErrors.push({ path, message: `invalid JSON: ${(e as Error).message}` });
    }
  }
  return { files, parseErrors };
}
