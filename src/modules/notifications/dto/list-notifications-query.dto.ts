import { z } from "zod";

// api-contract.md / decision-log.md 2026-09-08 #9 — GET /notifications?unreadOnly=true
// (default true). Query params HTTP llegan como string, no boolean — se
// transforma acá, no en el controller.
export const ListNotificationsQuerySchema = z.object({
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false"),
});
export type ListNotificationsQueryDto = z.infer<typeof ListNotificationsQuerySchema>;
