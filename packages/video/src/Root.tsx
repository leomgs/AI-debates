import React from "react";
import { Composition } from "remotion";
import type { RemotionManifest } from "@ai-trend-debates/contracts";
import { DebateComposition, DebateCompositionPropsSchema } from "./themes/default/DebateComposition";
import { totalDurationInFrames } from "./core/buildSequence";
import fixture from "../fixtures/debate.sample.json";

const FPS = 30;
const manifest = fixture as RemotionManifest;

// Registro de composiciones para Remotion Studio/render (spec 002, paso 6).
// Un solo placeholder ("Debate") contra el fixture congelado — abrir
// `pnpm video:studio` no necesita Postgres/SQLite, claves de API ni el
// backend corriendo, ese es el punto central de packages/video.
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Debate"
      component={DebateComposition}
      schema={DebateCompositionPropsSchema}
      durationInFrames={totalDurationInFrames(manifest, FPS)}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ manifest }}
    />
  );
};
