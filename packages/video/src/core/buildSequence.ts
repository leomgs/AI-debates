import type { RemotionManifest } from "@ai-trend-debates/contracts";

// spec 002 (docs/product/002-workspace-restructure.md, decisión "el core
// del video no conoce los themes") — el core arma las secuencias
// (offsets/duración en frames) a partir del manifest; los themes reciben ya
// resueltos los frames y solo se ocupan de qué se dibuja. Puro: sin React,
// sin Remotion, testeable sin renderizar nada.
export interface TimelineFrame {
  sequenceIndex: number;
  agentId: string;
  text: string;
  fromFrame: number;
  durationInFrames: number;
}

export function buildTimelineFrames(manifest: RemotionManifest, fps: number): TimelineFrame[] {
  let cursorFrame = 0;
  return manifest.timeline.map((entry) => {
    const durationInFrames = Math.max(1, Math.round((entry.durationMs / 1000) * fps));
    const frame: TimelineFrame = {
      sequenceIndex: entry.sequenceIndex,
      agentId: entry.agentId,
      text: entry.text,
      fromFrame: cursorFrame,
      durationInFrames,
    };
    cursorFrame += durationInFrames;
    return frame;
  });
}

// Duración total en frames de la composición — la suma real de los
// segmentos, no meta.durationEstimatedSec (que es solo informativo,
// features.md Feature 7).
export function totalDurationInFrames(manifest: RemotionManifest, fps: number): number {
  return buildTimelineFrames(manifest, fps).reduce((total, f) => total + f.durationInFrames, 0);
}
