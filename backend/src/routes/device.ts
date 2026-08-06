import { Router } from "express";
import { z } from "zod";
import { deviceQueue } from "../store/deviceQueue.js";
import { recordToolResult } from "../agent/orchestrator.js";

export const deviceRouter = Router();

/** O app faz polling aqui (acordado por push silenciosa) para buscar a próxima ação. */
deviceRouter.get("/device/:deviceId/next-action", (req, res) => {
  const action = deviceQueue.dequeueNext(req.params.deviceId);
  res.json({ action: action ?? null });
});

const reportSchema = z.object({
  userId: z.string().min(1),
  actionId: z.string().min(1),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

/** O app chama aqui depois de executar (ou falhar em executar) uma ação. */
deviceRouter.post("/device/:deviceId/report", async (req, res) => {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { userId, actionId, result, error } = parsed.data;
  deviceQueue.reportResult(actionId, result, error);

  const outcome = await recordToolResult(userId, req.params.deviceId, actionId, result, error);
  res.json({ outcome });
});
