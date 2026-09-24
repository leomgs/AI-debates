import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

// Entrypoint de Remotion Studio/render (`remotion studio src/index.ts`,
// script `studio`). También el entrypoint del paquete como librería
// (package.json `main`) para un futuro worker de render (Feature 9, todavía
// sin arrancar) que necesite importar las composiciones directamente.
export * from "./core/buildSequence";
export * from "./themes/default/DebateComposition";

registerRoot(RemotionRoot);
