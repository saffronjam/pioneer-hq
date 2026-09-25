import path from "path";
import { cpSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

// ----------------------------------------------------------------------

const PORT = 3039;

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: "copy-public-assets",
    apply: "build",
    writeBundle() {
      const publicDir = path.resolve(__dirname, "public");
      const gameAssets = path.join(publicDir, "assets/images/satisfactory");
      cpSync(publicDir, path.resolve(__dirname, "../api/web/dist"), {
        recursive: true,
        filter: (source) => source !== gameAssets,
      });
    },
  }],
  define: {
    __BUILD_VERSION__: JSON.stringify(process.env.VITE_BUILD_VERSION || "localbuild"),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "~": path.join(process.cwd(), "node_modules"),
      src: path.join(process.cwd(), "src"),
    },
  },
  build: { outDir: path.resolve(__dirname, "../api/web/dist"), emptyOutDir: true, copyPublicDir: false },
  server: {
    port: PORT,
    host: true,
    fs: { cachedChecks: false },
    watch: {
      ignored: ["**/dist/**", "**/public/assets/images/satisfactory/**"],
    },
    proxy: {
      "/graphql": { target: "http://localhost:8081", changeOrigin: true, ws: true },
    },
  },
  preview: { port: PORT, host: true },
});
