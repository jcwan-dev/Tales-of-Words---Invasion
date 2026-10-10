import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the same build works on GitHub Pages (sub-path), preview hosts and inside Capacitor.
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __BUILD_SHA__: JSON.stringify((process.env["GITHUB_SHA"] ?? "local").slice(0, 7)),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: { port: 5173 },
});
