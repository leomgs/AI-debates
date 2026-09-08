import { z } from "zod";

// api-contract.md §3/§5 — las 5 acciones de curaduría válidas.
export const ActionNameSchema = z.enum(["approve", "edit", "regenerate", "reject", "resume"]);
export type ActionName = z.infer<typeof ActionNameSchema>;
