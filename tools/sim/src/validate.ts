/**
 * Validates every content pack under content/. Exits 1 on any issue, so CI fails.
 * Usage: pnpm validate:content
 */
import { validatePack } from "@tow/core";
import { listPacks, loadPackFiles } from "./packs.ts";

let failed = false;
for (const pack of listPacks()) {
  const { files, parseErrors } = loadPackFiles(pack);
  const { issues, pack: loaded } = validatePack(pack, files);
  const all = [...parseErrors, ...issues];
  if (all.length > 0) {
    failed = true;
    console.error(`✗ ${pack}: ${all.length} issue(s)`);
    for (const i of all) console.error(`  ${i.path}  ${i.message}`);
  } else {
    const counts = new Map<string, number>();
    for (const def of loaded?.byId.values() ?? []) counts.set(def.kind, (counts.get(def.kind) ?? 0) + 1);
    const summary = [...counts].map(([k, n]) => `${n} ${k}`).join(", ");
    console.log(`✓ ${pack}: ${files.length} files valid (${summary})`);
  }
}
process.exit(failed ? 1 : 0);
