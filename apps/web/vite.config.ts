import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In development the UI runs on its own port; the API stays on the server's.
    proxy: { "/api": "http://127.0.0.1:4178" },
  },
  build: { outDir: "dist" },
});
