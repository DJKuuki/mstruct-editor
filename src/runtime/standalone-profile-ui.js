import { getEmbeddedMstructProfile } from "./embedded-profile.js";
import { createStandaloneProfiles } from "./standalone-profiles.js";
import { setupProfileManager } from "../ui/profile-manager.js";
import { AUTHORING_APP_VERSION } from "./authoring-version.js";

/** Assemble the standalone rules UI without teaching main.js transport details. */
export function setupStandaloneProfileRuntime({ platform, button, tr, documentErrorMessage, getDocumentIdentity, retryDocument, isReadOnly }) {
  const service = createStandaloneProfiles({ platform, embeddedProfile: getEmbeddedMstructProfile, authoringAppVersion: AUTHORING_APP_VERSION });
  const ui = setupProfileManager({ service, button, enabled: Boolean(platform), tr, getDocumentIdentity, retryDocument, isReadOnly,
    errorMessage: (error) => error.code ? documentErrorMessage(error) : tr("profileOperationFailed"),
  });
  return { service, ui };
}
