import { Router } from "express";
import { z } from "zod";
import { startTurn } from "../agent/orchestrator.js";

const bodySchema = z.object({
  userId: z.string().min(1),
  deviceId: z.string().min(1),
  deviceToken: z.string().min(1),
  text: z.string().min(1),
});

export const commandRouter = Router();

commandRouter.post("/command", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { userId, deviceId, deviceToken, text } = parsed.data;
  const outcome = await startTurn(userId, deviceId, deviceToken, text);
  res.json(outcome);
});
