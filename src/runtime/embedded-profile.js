import bundle from "../config/official-profile.json";
import { verifyMstructProfile } from "../core/profile.js";
let verified;
/** First formal snapshot is independent from mutable source CSV defaults. */
export function getEmbeddedMstructProfile() {
  verified ??= verifyMstructProfile(bundle);
  return verified;
}
