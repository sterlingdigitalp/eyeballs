import { useState } from "react";
import type { ConsentRecord, ConsentScope } from "../../../../packages/contracts/src";
import {
  grantConsent,
  revokeConsent,
  scopesAreIndependent,
} from "../../../../packages/dataset/src";
import { store } from "../lib/store";

const SCOPE_OPTIONS: { scope: ConsentScope; label: string; note: string }[] = [
  { scope: "recording", label: "Recording", note: "Capture video/audio" },
  {
    scope: "dataset_include",
    label: "Dataset include",
    note: "Allow human promotion into dataset versions",
  },
  {
    scope: "face_analysis",
    label: "Face analysis",
    note: "Offline face/landmarks — separate from voice",
  },
  {
    scope: "voice_analysis",
    label: "Voice analysis",
    note: "Transcription/voice features — separate from face",
  },
];

export function ConsentPanel({
  consents,
  onChange,
}: {
  consents: ConsentRecord[];
  onChange: (next: ConsentRecord[]) => void;
}) {
  const [selected, setSelected] = useState<ConsentScope[]>(["recording"]);
  const face = consents.find(
    (record) => record.scopes.includes("face_analysis") && !record.revokedAt,
  );
  const voice = consents.find(
    (record) => record.scopes.includes("voice_analysis") && !record.revokedAt,
  );
  const independentNote =
    face && voice ? scopesAreIndependent(face, voice) : true;

  const persist = async (next: ConsentRecord[]) => {
    await store.consents.putAll(next);
    onChange(next);
  };

  return (
    <section className="screen" data-dataset-consent="true">
      <div className="screen-copy">
        <p className="eyebrow">Consent center</p>
        <h1>Explicit permissions</h1>
        <p className="lede">
          Recording, dataset promotion, face analysis, and voice analysis are separate decisions.
          Grants persist locally across restarts.
        </p>
      </div>
      <div className="panel">
        <h2>Grant scopes</h2>
        {SCOPE_OPTIONS.map((option) => (
          <label key={option.scope} className="feature-flag">
            <input
              type="checkbox"
              checked={selected.includes(option.scope)}
              onChange={(event) => {
                setSelected((current) =>
                  event.target.checked
                    ? [...current, option.scope]
                    : current.filter((scope) => scope !== option.scope),
                );
              }}
            />
            <span>
              <strong>{option.label}</strong> — {option.note}
            </span>
          </label>
        ))}
        <button
          type="button"
          onClick={() => {
            if (!selected.length) return;
            const nextRecords = [...consents];
            for (const scope of selected) {
              nextRecords.push(
                grantConsent(crypto.randomUUID(), [scope], new Date().toISOString()),
              );
            }
            void persist(nextRecords);
            setSelected(["recording"]);
          }}
        >
          Grant selected
        </button>
        <p className="muted">
          Face/voice independence: {independentNote ? "ok" : "review grants"}
        </p>
      </div>
      <div className="panel">
        <h2>Active and revoked</h2>
        {!consents.length && <p className="muted">No consents yet.</p>}
        {consents.map((record) => (
          <div key={record.id} className="cue-rating-row">
            <span>
              {record.scopes.join(", ")} · {record.id.slice(0, 8)}
              {record.revokedAt ? ` · revoked ${record.revokedAt}` : " · active"}
            </span>
            {!record.revokedAt && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  void persist(
                    consents.map((entry) =>
                      entry.id === record.id
                        ? revokeConsent(entry, new Date().toISOString())
                        : entry,
                    ),
                  );
                }}
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
