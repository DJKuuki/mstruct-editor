import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageUrl = new URL("../package.json", import.meta.url);
const packageLockUrl = new URL("../package-lock.json", import.meta.url);

export function nextDesktopVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  if (!match) throw new Error(`Desktop version must have three numeric parts: ${version}`);
  return `${match[1]}.${match[2]}.${Number.parseInt(match[3], 10) + 1}`;
}

export function desktopBuildVersion(version, artifactsExist) {
  return artifactsExist ? nextDesktopVersion(version) : version;
}

async function bumpDesktopVersion() {
  const [packageText, packageLockText] = await Promise.all([
    readFile(packageUrl, "utf8"),
    readFile(packageLockUrl, "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);
  const packageLock = JSON.parse(packageLockText);
  let nextVersion;
  if (process.argv.includes("--prepare-build")) {
    const base = new URL(`../release/MStruct-Analysis-Editor-${packageJson.version}-win-x64`, import.meta.url);
    const existing = await Promise.all([base, new URL(`${base.href}.zip`)].map(async url => {
      try { await access(url); return true; }
      catch (error) { if (error.code === "ENOENT") return false; throw error; }
    }));
    nextVersion = desktopBuildVersion(packageJson.version, existing.some(Boolean));
  } else {
    nextVersion = nextDesktopVersion(packageJson.version);
  }
  packageJson.version = nextVersion;
  packageLock.version = nextVersion;
  if (packageLock.packages?.[""]) packageLock.packages[""].version = nextVersion;
  await Promise.all([
    writeFile(packageUrl, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8"),
    writeFile(packageLockUrl, `${JSON.stringify(packageLock, null, 2)}\n`, "utf8"),
  ]);
  console.log(`Desktop version: ${nextVersion}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await bumpDesktopVersion();
}
