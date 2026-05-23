import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** GitHub Pages 本番: /CEA/ — ローカル dev は / */
const repoBase = process.env.VITE_BASE_PATH ?? "/";

export default defineConfig({
  plugins: [react()],
  base: repoBase,
  root: ".",
  publicDir: "public",
  server: { port: 5173, open: true },
});
