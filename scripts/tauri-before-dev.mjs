import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const atlasOrigin = "http://127.0.0.1:1420";

async function healthyAtlas() {
  try {
    const [rootResponse, treeResponse] = await Promise.all([
      fetch(`${atlasOrigin}/`, {
        cache: "no-store",
        signal: AbortSignal.timeout(1_500),
      }),
      fetch(`${atlasOrigin}/api/content/tree`, {
        cache: "no-store",
        signal: AbortSignal.timeout(1_500),
      }),
    ]);
    if (!rootResponse.ok || !treeResponse.ok) return false;
    const [root, tree] = await Promise.all([
      rootResponse.text(),
      treeResponse.json(),
    ]);
    return root.includes('<div id="root">') && Array.isArray(tree);
  } catch {
    return false;
  }
}

// A Tauri launch often follows browser development. Reusing that exact Vite
// listener avoids a strict-port race and, more importantly, keeps one writable
// content API process serving the canonical study/content tree.
let reuseExistingServer = false;
for (let attempt = 0; attempt < 3; attempt += 1) {
  if (await healthyAtlas()) {
    reuseExistingServer = true;
    break;
  }
  if (attempt < 2) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

if (reuseExistingServer) {
  console.log("Math Atlas is already healthy on http://127.0.0.1:1420; reusing it.");
} else {
  const viteEntry = fileURLToPath(
    new URL("../node_modules/vite/bin/vite.js", import.meta.url),
  );
  const vite = spawn(process.execPath, [viteEntry], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: "inherit",
    windowsHide: true,
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => vite.kill(signal));
  }

  vite.on("error", (error) => {
    console.error(`Could not start the Math Atlas development server: ${error.message}`);
    process.exitCode = 1;
  });

  vite.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
