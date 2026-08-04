import { defineConfig } from "vite";
import anywidget from "@anywidget/vite";

// anywidget loads each _esm file as a self-contained module (relative
// imports don't resolve from a blob URL), so every widget entry gets its
// own vite invocation: a single multi-entry build would split shared lib
// code into chunks the entries import relatively. npm run build loops
// over the entries via ENTRY.
export default defineConfig({
  build: {
    outDir: "src/cpt_anywidget/static",
    emptyOutDir: false,
    // the bundles are committed and read in diffs, keep them readable
    minify: false,
    lib: {
      entry: [process.env.ENTRY ?? "js/cpt-viewer.ts"],
      formats: ["es"],
    },
  },
  plugins: [anywidget()],
});
