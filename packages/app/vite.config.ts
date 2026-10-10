import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const buildSha = (process.env["GITHUB_SHA"] ?? "local").slice(0, 7);
const buildTime = new Date().toISOString();

/** Emits version.json next to index.html so a deploy can be checked without running the page. */
function versionFile(): Plugin {
  return {
    name: "tow-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify({ sha: buildSha, builtAt: buildTime })}\n`,
      });
    },
  };
}

// Relative base so the same build works on GitHub Pages (sub-path), preview hosts and inside Capacitor.
export default defineConfig({
  base: "./",
  plugins: [react(), versionFile()],
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  server: { port: 5173 },
});
