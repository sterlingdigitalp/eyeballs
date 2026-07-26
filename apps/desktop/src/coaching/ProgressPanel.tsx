import { useEffect, useMemo, useState } from "react";
import type { RecommendationFeedback } from "../../../../packages/contracts/src";
import {
  applyRecommendationFeedback,
  groupComparableSessions,
  measurementDegradationNotes,
  recommendNext,
  type Recommendation,
} from "../../../../packages/coaching/src";
import { store, type StoredSession } from "../lib/store";

export function ProgressPanel({
  sessions,
  onFollowDrill,
}: {
  sessions: StoredSession[];
  onFollowDrill?: (drillId: string, recommendationId: string) => void;
}) {
  const [feedback, setFeedback] = useState<RecommendationFeedback[]>([]);

  useEffect(() => {
    void store.recommendationFeedback.all().then(setFeedback);
  }, []);

  const series = useMemo(
    () =>
      groupComparableSessions(
        sessions.map((session) => ({
          manifest: session.manifest,
          predictions: session.predictions,
          events: session.events,
          speakingWindows: session.speakingWindows,
        })),
      ),
    [sessions],
  );
  const latestCoached = [...sessions]
    .filter((session) => session.manifest.coaching)
    .sort((a, b) => b.manifest.startedAt.localeCompare(a.manifest.startedAt))[0];

  const baseRecommendation = useMemo(() => {
    if (!latestCoached) return undefined;
    return recommendNext({
      latest: {
        manifest: latestCoached.manifest,
        predictions: latestCoached.predictions,
        events: latestCoached.events,
      },
    });
  }, [latestCoached]);

  const storedForBase = feedback.find(
    (entry) => entry.recommendationId === baseRecommendation?.id,
  );

  const activeRecommendation: Recommendation | undefined = useMemo(() => {
    if (!baseRecommendation) return undefined;
    if (storedForBase?.dismissed) return undefined;
    return applyRecommendationFeedback(baseRecommendation, {
      pinned: storedForBase?.pinned,
      dismissed: storedForBase?.dismissed,
      followed: storedForBase?.followed,
      useful: storedForBase?.useful,
    });
  }, [baseRecommendation, storedForBase]);

  const persistFeedback = async (
    recommendation: Recommendation,
    patch: Partial<RecommendationFeedback>,
  ) => {
    const record: RecommendationFeedback = {
      id: `rf-${recommendation.id}`,
      recommendationId: recommendation.id,
      drillId: recommendation.drillId,
      pinned: patch.pinned ?? storedForBase?.pinned,
      dismissed: patch.dismissed ?? storedForBase?.dismissed,
      followed: patch.followed ?? storedForBase?.followed,
      useful: patch.useful ?? storedForBase?.useful,
      updatedAt: new Date().toISOString(),
      ...patch,
    };
    const next = await store.recommendationFeedback.upsert(record);
    setFeedback(next);
  };

  const degradation = series.flatMap(measurementDegradationNotes);

  return (
    <section className="screen progress-screen">
      <div className="screen-copy">
        <p className="eyebrow">Progress</p>
        <h1>Like-for-like trends</h1>
        <p className="lede">
          Comparisons only group the same drill, profile, feedback mode, and scoring-policy version.
          Contact-during-speaking requires persisted speaking windows from a session.
        </p>
      </div>
      {activeRecommendation && (
        <div className="recommendation-card" data-recommendation-id={activeRecommendation.id}>
          <strong>{activeRecommendation.title}</strong>
          <p>{activeRecommendation.reason}</p>
          <p className="muted">
            {activeRecommendation.action}
            {activeRecommendation.drillId ? ` · ${activeRecommendation.drillId}` : ""}
            {" · "}
            {activeRecommendation.rulesVersion}
          </p>
          <div className="button-row">
            <button
              type="button"
              className="secondary"
              onClick={() => void persistFeedback(activeRecommendation, { pinned: true })}
            >
              Pin
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void persistFeedback(activeRecommendation, { dismissed: true })}
            >
              Dismiss
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                void persistFeedback(activeRecommendation, {
                  followed: true,
                  useful: true,
                });
                if (activeRecommendation.drillId) {
                  onFollowDrill?.(activeRecommendation.drillId, activeRecommendation.id);
                }
              }}
            >
              Follow drill
            </button>
          </div>
        </div>
      )}
      {storedForBase?.dismissed && (
        <p className="muted">Latest recommendation dismissed (persisted).</p>
      )}
      {degradation.length > 0 && (
        <div className="panel">
          <h2>Measurement quality</h2>
          {degradation.map((note) => (
            <p key={note} className="tracking-warning">
              {note}
            </p>
          ))}
        </div>
      )}
      {!series.length && <div className="panel">Complete coached sessions to see trends.</div>}
      {series.map((group) => (
        <div
          className="panel"
          key={`${group.key.drillId}-${group.key.feedbackIntensity}-${group.key.profileId}`}
        >
          <h2>
            {group.key.drillId} · {group.key.feedbackIntensity} ·{" "}
            {group.key.profileId.slice(0, 8)}
          </h2>
          <p className="muted">
            Scoring {group.key.scoringPolicyVersion}
            {group.baselineSessionId ? ` · baseline ${group.baselineSessionId.slice(0, 8)}` : ""}
          </p>
          <div className="progress-grid">
            <div className="progress-card">
              Contact while speaking
              <strong>
                {group.trends.contactDuringSpeaking.at(-1) !== undefined
                  ? `${((group.trends.contactDuringSpeaking.at(-1) as number) * 100).toFixed(0)}%`
                  : "— (need VAD windows)"}
              </strong>
            </div>
            <div className="progress-card">
              Breaks / min
              <strong>{group.trends.breaksPerMinute.at(-1)?.toFixed(1) ?? "—"}</strong>
            </div>
            <div className="progress-card">
              Median break
              <strong>
                {group.trends.medianBreakMs.at(-1) !== undefined
                  ? `${Math.round(group.trends.medianBreakMs.at(-1) as number)} ms`
                  : "—"}
              </strong>
            </div>
            <div className="progress-card">
              Comfort after
              <strong>{group.trends.comfortAfter.at(-1) ?? "—"}</strong>
            </div>
            <div className="progress-card">
              Tracking confidence
              <strong>
                {group.trends.trackingConfidence.at(-1) !== undefined
                  ? `${((group.trends.trackingConfidence.at(-1) as number) * 100).toFixed(0)}%`
                  : "—"}
              </strong>
            </div>
          </div>
          <p className="muted">{group.points.length} comparable session(s)</p>
        </div>
      ))}
    </section>
  );
}
