const { existsSync, mkdirSync, renameSync, writeFileSync, rmSync, unlinkSync } = require("node:fs");
const path = require("node:path");

const MARKER = "user-data.json", RESET = "reset-pending.json";
const MANAGED = ["chromium", "mstruct-profiles", "recent-documents.json", "library.json", "audio-associations.json", "logs", "crashes"];

function writeMarker(directory, values = {}) {
  const file = path.join(directory, MARKER), temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version: 2, storage: "chromium/Local Storage", profiles: "mstruct-profiles", ...values }, null, 2), "utf8");
  renameSync(temporary, file);
}

/** Queue the reset; Chromium files are removed before ready on the next launch. */
function requestUserDataReset(directory) {
  if (!existsSync(path.join(directory, MARKER))) throw Error("Unrecognized user data directory.");
  writeFileSync(path.join(directory, RESET), "{}", "utf8");
}

/** LocalAppData already belongs to one OS account and remains stable across app versions. */
function configureUserData(app, { isolatedDirectory, localAppData = process.env.LOCALAPPDATA, claimDirectory = () => true } = {}) {
  const directory = path.resolve(isolatedDirectory || path.join(localAppData || path.resolve(app.getPath("appData"), "..", "Local"), "MStruct", "Analysis Editor"));
  const sessionDirectory = path.join(directory, "chromium");
  for (const [name, target] of Object.entries({ userData: directory, sessionData: sessionDirectory, logs: path.join(directory, "logs"), crashDumps: path.join(directory, "crashes") })) {
    mkdirSync(target, { recursive: true });
    app.setPath(name, target);
  }
  if (!claimDirectory()) return null;
  const reset = path.join(directory, RESET);
  if (existsSync(reset)) {
    // Only named app-owned files are removed. Library roots and their files are never followed.
    for (const name of MANAGED) {
      const target = path.resolve(directory, name);
      if (path.dirname(target) !== directory || target === path.parse(target).root) throw Error("Unsafe user data reset path.");
      rmSync(target, { recursive: true, force: true });
    }
    writeMarker(directory, { resetAt: new Date().toISOString() });
    unlinkSync(reset);
  } else if (!existsSync(path.join(directory, MARKER))) {
    writeMarker(directory);
  }
  for (const name of ["chromium", "logs", "crashes"]) mkdirSync(path.join(directory, name), { recursive: true });
  return directory;
}

module.exports = { configureUserData, requestUserDataReset };
