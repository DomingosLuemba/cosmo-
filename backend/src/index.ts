import "dotenv/config";
import express from "express";
import { config } from "./config.js";
import { commandRouter } from "./routes/command.js";
import { deviceRouter } from "./routes/device.js";
import { approvalsRouter } from "./routes/approvals.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(commandRouter);
app.use(deviceRouter);
app.use(approvalsRouter);

app.listen(config.port, () => {
  console.log(`Cosmo backend ouvindo em http://localhost:${config.port}`);
});
