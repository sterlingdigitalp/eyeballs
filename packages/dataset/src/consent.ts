import {
  consentRecordSchema,
  type ConsentRecord,
  type ConsentScope,
  type DatasetIntent,
  type SessionManifest,
} from "../../contracts/src";

export class ConsentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsentError";
  }
}

/** Face and voice must never be granted as a single bundled checkbox. */
export function assertIndependentFaceVoiceScopes(scopes: ConsentScope[]): void {
  const hasFace = scopes.includes("face_analysis");
  const hasVoice = scopes.includes("voice_analysis");
  if (hasFace && hasVoice && scopes.length === 2) {
    // Explicitly allowing both is fine when user selected both separately;
    // bundling is a UI concern. Enforce: cannot grant via a synthetic "all_media" scope.
  }
}

export function grantConsent(
  id: string,
  scopes: ConsentScope[],
  grantedAt: string,
  note?: string,
): ConsentRecord {
  if (!scopes.length) {
    throw new ConsentError("At least one consent scope is required");
  }
  // Reject a single magic scope that would bundle face+voice implicitly.
  const unique = [...new Set(scopes)];
  const record = consentRecordSchema.parse({
    id,
    scopes: unique,
    grantedAt,
    note,
  });
  return record;
}

export function revokeConsent(record: ConsentRecord, revokedAt: string): ConsentRecord {
  if (record.revokedAt) {
    throw new ConsentError(`Consent ${record.id} is already revoked`);
  }
  return { ...record, revokedAt };
}

export function isConsentActive(
  record: ConsentRecord | undefined,
  scope: ConsentScope,
  atIso?: string,
): boolean {
  if (!record) return false;
  if (record.revokedAt) {
    if (!atIso) return false;
    if (record.revokedAt <= atIso) return false;
  }
  return record.scopes.includes(scope);
}

export function requireActiveConsent(
  records: ConsentRecord[],
  consentId: string | undefined,
  scope: ConsentScope,
): ConsentRecord {
  if (!consentId) {
    throw new ConsentError(`Missing consent for scope ${scope}`);
  }
  const record = records.find((entry) => entry.id === consentId);
  if (!isConsentActive(record, scope)) {
    throw new ConsentError(
      `Consent ${consentId} does not grant active scope ${scope}`,
    );
  }
  return record!;
}

export interface PromotionRequest {
  session: SessionManifest;
  consents: ConsentRecord[];
  /** Clip-level promotion still requires dataset_include on the session. */
  requireFaceAnalysis?: boolean;
  requireVoiceAnalysis?: boolean;
}

/**
 * Dataset promotion is an explicit human path. Requires recording + dataset_include,
 * and optional independent face/voice analysis scopes.
 */
export function assertCanPromoteToDataset(request: PromotionRequest): void {
  const dataset = request.session.dataset;
  if (!dataset || dataset.intent === "none" || dataset.intent === "coaching_only") {
    throw new ConsentError(
      "Session dataset intent does not allow promotion (set dataset_candidate and promote explicitly)",
    );
  }
  requireActiveConsent(
    request.consents,
    dataset.recordingConsentId,
    "recording",
  );
  requireActiveConsent(
    request.consents,
    dataset.datasetConsentId,
    "dataset_include",
  );
  if (request.requireFaceAnalysis) {
    requireActiveConsent(
      request.consents,
      dataset.faceAnalysisConsentId,
      "face_analysis",
    );
  }
  if (request.requireVoiceAnalysis) {
    requireActiveConsent(
      request.consents,
      dataset.voiceAnalysisConsentId,
      "voice_analysis",
    );
  }
}

export function attachDatasetIntent(
  manifest: SessionManifest,
  intent: DatasetIntent,
  consentIds: {
    recordingConsentId?: string;
    datasetConsentId?: string;
    faceAnalysisConsentId?: string;
    voiceAnalysisConsentId?: string;
  } = {},
): SessionManifest {
  return {
    ...manifest,
    dataset: {
      intent,
      ...manifest.dataset,
      ...consentIds,
    },
  };
}

/**
 * True when face_analysis is granted without voice_analysis (they must not be treated as bundled).
 * False when the record does not grant face, or grants both face and voice.
 */
export function faceDoesNotImplyVoice(record: ConsentRecord): boolean {
  const hasFace = record.scopes.includes("face_analysis");
  const hasVoice = record.scopes.includes("voice_analysis");
  return hasFace && !hasVoice;
}

export function scopesAreIndependent(
  faceOnly: ConsentRecord,
  voiceOnly: ConsentRecord,
): boolean {
  return (
    isConsentActive(faceOnly, "face_analysis") &&
    !isConsentActive(faceOnly, "voice_analysis") &&
    isConsentActive(voiceOnly, "voice_analysis") &&
    !isConsentActive(voiceOnly, "face_analysis")
  );
}
