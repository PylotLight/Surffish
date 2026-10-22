import { defineConfig } from "vite";
import { externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  plugins: [externalizeDepsPlugin()],
  build: {
    ssr: "scripts/electron-host-tab-frame-probe.ts",
    target: "node22",
    outDir: "out/host-probe",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "probe.mjs",
      },
    },
  },
});
