import { defineConfig } from "vite";

// Relative asset URLs let the exact same Vite build run on its own and be
// copied beneath the main site's /mstruct-editor/ path without a second UI.
export default defineConfig({
  base: "./",
  build: {
    rolldownOptions: {
      preserveEntrySignatures: "strict",
      input: { editor: "index.html", profile: "src/profile.js" },
      output: { entryFileNames: (chunk) => chunk.name === "profile" ? "profile.js" : "assets/[name]-[hash].js" },
    },
  },
});
