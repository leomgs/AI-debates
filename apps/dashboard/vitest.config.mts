import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests unitarios de la lógica del dashboard (sin DOM): validación de `next`,
// errores de la API, manejo global del 401, proxy y mapeo de estados.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
