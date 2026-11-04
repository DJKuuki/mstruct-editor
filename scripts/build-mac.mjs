import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch)) {
  throw Error("macOS packaging requires a native arm64 or x64 Mac; use the macOS GitHub Actions workflow.");
}
const cwd = fileURLToPath(new URL("../", import.meta.url));
for (const args of [["run", "desktop:prepare"], ["run", "build"],
  ["exec", "--", "electron-builder", "--config", "desktop/electron-builder.mac.cjs", "--mac", `--${process.arch}`, "--publish", "never"]]) {
  const result = spawnSync("npm", args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
