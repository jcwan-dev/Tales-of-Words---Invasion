import { validatePack, type ContentFile, type ValidationResult } from "@tow/core";

// Bundled at build time. In M2 this becomes the content loader for packs.
const modules = import.meta.glob<unknown>(["../../../content/base/**/*.json", "!**/pack.json"], {
  eager: true,
  import: "default",
});

const files: ContentFile[] = Object.entries(modules).map(([path, data]) => ({
  path: path.replace(/^(\.\.\/)+content\//, ""),
  data,
}));

export const baseContent: ValidationResult & { fileCount: number } = {
  ...validatePack("base", files),
  fileCount: files.length,
};
