import type { RecognizedGesture } from "../types";
import type {
  TimedVoteSample,
  TimeWeightedVoteResult,
} from "../../../.swarm/contracts/types";

/**
 * Subagent S8 — Frame-Rate Invariant Time-Weighted Gesture Voter
 * Replaces fixed-frame-count voting with continuous elapsed-time integration (dt in [4ms, 100ms])
 * over a sliding 350ms physical window so commit latency is identical (~350ms +- 35ms)
 * across 12fps budget phones, 30fps webcams, and 120Hz ProMotion displays.
 */
export class TimeWeightedGestureVoter {
  private buf: Array<TimedVoteSample & { confidence: number }> = [];
  private committed: RecognizedGesture = "UNKNOWN";
  private streak = 0;
  private lastT: number | null = null;

  constructor(
    private readonly windowMs = 350,
    private readonly commitTimeRatio = 0.60,
    private readonly releaseTimeRatio = 0.35
  ) {}

  reset(): void {
    this.buf = [];
    this.committed = "UNKNOWN";
    this.streak = 0;
    this.lastT = null;
  }

  push(
    gesture: RecognizedGesture,
    confidence: number = 0.9,
    nowMs: number = performance.now()
  ): TimeWeightedVoteResult {
    const dtMs =
      this.lastT !== null
        ? Math.max(4, Math.min(100, nowMs - this.lastT))
        : 0;
    this.lastT = nowMs;

    this.buf.push({ gesture, timestampMs: nowMs, dtMs, confidence });

    // Evict samples older than windowMs
    const cutoff = nowMs - this.windowMs;
    while (this.buf.length > 1 && this.buf[0].timestampMs < cutoff) {
      this.buf.shift();
    }

    const durByG = new Map<RecognizedGesture, number>();
    const confWeightedByG = new Map<RecognizedGesture, number>();
    let totalDurationMs = 0;

    for (const s of this.buf) {
      totalDurationMs += s.dtMs;
      durByG.set(s.gesture, (durByG.get(s.gesture) || 0) + s.dtMs);
      confWeightedByG.set(
        s.gesture,
        (confWeightedByG.get(s.gesture) || 0) + s.confidence * s.dtMs
      );
    }

    let topG: RecognizedGesture = "UNKNOWN";
    let topDur = 0;
    durByG.forEach((dur, g) => {
      if (g !== "UNKNOWN" && dur > topDur) {
        topG = g;
        topDur = dur;
      }
    });

    const effectiveWindow = Math.max(this.windowMs * this.commitTimeRatio, totalDurationMs);
    const topRatio = effectiveWindow > 0 ? topDur / effectiveWindow : 0;
    const topMeanConf = topDur > 0 ? (confWeightedByG.get(topG) || 0) / topDur : 0;

    const currentCommitted: RecognizedGesture = this.committed;
    if (currentCommitted === "UNKNOWN") {
      if (
        topG !== "UNKNOWN" &&
        topDur >= this.windowMs * this.commitTimeRatio &&
        topRatio >= this.commitTimeRatio &&
        topMeanConf >= 0.58
      ) {
        this.committed = topG;
        this.streak = 1;
      } else {
        this.streak = 0;
      }
    } else {
      const curDur = durByG.get(currentCommitted) || 0;
      const curRatio = effectiveWindow > 0 ? curDur / effectiveWindow : 0;
      if (
        topG !== "UNKNOWN" &&
        topG !== currentCommitted &&
        topRatio >= this.commitTimeRatio &&
        topMeanConf >= 0.62
      ) {
        this.committed = topG;
        this.streak = 1;
      } else if (curRatio < this.releaseTimeRatio) {
        this.committed = "UNKNOWN";
        this.streak = 0;
      } else {
        this.streak += 1;
      }
    }

    return {
      committed: this.committed,
      raw: gesture,
      agreement: Math.min(1, Math.round(topRatio * 100) / 100),
      windowMs: this.windowMs,
      accumulatedCommitMs: Math.round(topDur),
      streak: this.streak,
    };
  }
}
