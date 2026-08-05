import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentApiPlugin } from "./scripts/content-api-plugin";
import { atlasApiPlugin } from "./scripts/atlas-api-plugin";
import { assetApiPlugin } from "./scripts/asset-api-plugin";

const host = process.env.TAURI_DEV_HOST;
const projectRoot = fileURLToPath(new URL(".", import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => {
  const contentRoot = path.join(projectRoot, "content");
  return {
    plugins: [
      react(),
      contentApiPlugin(contentRoot),
      atlasApiPlugin(contentRoot),
      assetApiPlugin(contentRoot),
    ],

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // Canonical notes are served by the repository plugins and refreshed
        // explicitly by the app. Watching the vault-sized content tree wastes
        // work and, on Windows, keeps directory handles open during a
        // transactional import.
        ignored: ["**/src-tauri/**", "**/content/**"],
      },
    },
  };
});
