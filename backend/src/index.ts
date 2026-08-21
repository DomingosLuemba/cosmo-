import "dotenv/config";
import { createServer } from "node:http";
import express from "express";
import { config } from "./config.js";
import { commandRouter } from "./routes/command.js";
import { deviceRouter } from "./routes/device.js";
import { approvalsRouter } from "./routes/approvals.js";
import { macRouter } from "./routes/mac.js";
import { attachMacRelay } from "./mac/relay.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(commandRouter);
app.use(deviceRouter);
app.use(approvalsRouter);
app.use(macRouter);

// O servidor HTTP precisa ser explícito (em vez de app.listen) para o
// WebSocket do agente macOS compartilhar a mesma porta.
const server = createServer(app);
attachMacRelay(server);

server.listen(config.port, () => {
  console.log(`Cosmo backend ouvindo em http://localhost:${config.port}`);
  console.log(`Agente do Mac conecta em ws://localhost:${config.port}/mac/agent`);
});
