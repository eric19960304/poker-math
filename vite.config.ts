import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/poker-math/",
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: "docs",
  },
});
