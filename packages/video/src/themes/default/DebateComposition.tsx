import React from "react";
import { z } from "zod";
import { AbsoluteFill, Sequence } from "remotion";
import { RemotionManifestSchema } from "@ai-trend-debates/contracts";
import { buildTimelineFrames } from "../../core/buildSequence";

// Theme placeholder (spec 002 no-objetivo: "no se diseñan themes nuevos") —
// alcance mínimo para probar que el pipeline manifest -> video real
// funciona: nombre del agente + texto, timeado por los frames reales que
// arma el core. Sin audio (evita bundlear un WAV estático solo para el
// scaffold; reproducir audio real es trabajo de la spec 003 de UI).
//
// Schema Zod para las props (no una interface suelta) — Remotion valida/
// tipa <Composition> contra un AnyZodObject nativamente (mismo patrón Zod
// que ya usa todo el proyecto), reusando RemotionManifestSchema de
// @ai-trend-debates/contracts en vez de duplicar el shape a mano.
export const DebateCompositionPropsSchema = z.object({ manifest: RemotionManifestSchema });
export type DebateCompositionProps = z.infer<typeof DebateCompositionPropsSchema>;

const FPS = 30;

export const DebateComposition: React.FC<DebateCompositionProps> = ({ manifest }) => {
  const frames = buildTimelineFrames(manifest, FPS);
  const agentById = new Map(manifest.agents.map((a) => [a.id, a]));

  return (
    <AbsoluteFill style={{ backgroundColor: "#111", fontFamily: "sans-serif" }}>
      {frames.map((frame) => {
        const agent = agentById.get(frame.agentId);
        return (
          <Sequence key={frame.sequenceIndex} from={frame.fromFrame} durationInFrames={frame.durationInFrames}>
            <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", padding: 64 }}>
              <div style={{ color: "#8ab4f8", fontSize: 32, fontWeight: 700, marginBottom: 16 }}>
                {agent?.name ?? frame.agentId}
              </div>
              <div style={{ color: "#fff", fontSize: 44, textAlign: "center", maxWidth: "80%" }}>{frame.text}</div>
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
