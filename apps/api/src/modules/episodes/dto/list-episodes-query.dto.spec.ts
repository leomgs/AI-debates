import { z } from "zod";
import { ListEpisodesQuerySchema } from "./list-episodes-query.dto";

// API-10: el `pattern` de `status` es solo documentación (openapi.json), así
// que tiene que aceptar exactamente lo que acepta
// EpisodesService.parseStatusFilter, ni más ni menos.
describe("ListEpisodesQuerySchema — pattern documentado de status", () => {
  const properties = z.toJSONSchema(ListEpisodesQuerySchema, { io: "input" }).properties as Record<string, { pattern: string }>;
  const pattern = new RegExp(properties.status.pattern);

  it.each(["", "PENDING_REVIEW", "PENDING_REVIEW,REQUIRES_HUMAN_REVIEW", " PENDING_REVIEW , APPROVED "])("acepta %j", (value) => {
    expect(pattern.test(value)).toBe(true);
  });

  it.each(["FOO", "pending_review", "PENDING_REVIEW,", ",PENDING_REVIEW", "PENDING_REVIEW,,APPROVED", " ", "PENDING_REVIEWX"])(
    "rechaza %j",
    (value) => {
      expect(pattern.test(value)).toBe(false);
    }
  );

  it("no valida en runtime: parseStatusFilter sigue siendo el que decide (mismo 400)", () => {
    expect(ListEpisodesQuerySchema.parse({ status: "FOO" })).toEqual({ status: "FOO" });
  });
});
