import { parseMstructDocument } from "../core/mstruct-document.js";
import { readProfileIdentity } from "../core/profile-schema.js";
import { validateHostedImportIdentity } from "./hosted-document.js";

/** Document loading coordinates exact identity before the UI receives content. */
export function createAnalysisDocumentLoader({ hostedMode, profileSession, prepareStandalone, getMetadata,
  metadataAfterImport, applyDocument, render, setError }) {
  return async (source, name = "") => {
    try {
      const standalone = !hostedMode ? await prepareStandalone(source) : null;
      const preparedSource = hostedMode ? await profileSession.prepareImport(source) : standalone?.source ?? source;
      const document = parseMstructDocument(preparedSource);
      if (!document.ok) { setError(document.errors[0] ?? { code: "profile-assignment-required" }); return { loaded: false, scoreOk: false }; }
      if (hostedMode) validateHostedImportIdentity(document.metadata, getMetadata());
      const metadata = metadataAfterImport(document.metadata);
      if (standalone?.error) profileSession.block(standalone.error);
      else {
        const identity = readProfileIdentity(metadata);
        if (identity) {
          const prepared = await profileSession.load(metadata, hostedMode ? profileSession.profile : undefined);
          if (prepared.cancelled) return { loaded: false, scoreOk: false };
        } else if (hostedMode) throw Object.assign(new Error(), { code: "profile-assignment-required" });
        else profileSession.block({ code: "profile-assignment-required" });
      }
      applyDocument(document, metadata, name);
      const result = render(document, name);
      return { loaded: true, scoreOk: result.ok, changed: Boolean(standalone?.changed) };
    } catch (error) { setError(error); return { loaded: false, scoreOk: false }; }
  };
}
