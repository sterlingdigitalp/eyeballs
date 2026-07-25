import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "apps/desktop",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: ["es2022", "chrome120", "safari15"],
    outDir: "../../dist",
    emptyOutDir: true,
  },
});
