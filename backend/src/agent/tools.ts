import type Anthropic from "@anthropic-ai/sdk";

/**
 * Catálogo de ações que o app iOS sabe executar de verdade (via App Intents,
 * EventKit, HomeKit, etc — ver docs/ARCHITECTURE.md). Cada tool aqui precisa
 * ter um AppIntent correspondente em ios-app/CosmoController/Intents.
 *
 * Este catálogo é a única fonte de ações possíveis: o Claude nunca deve
 * inventar uma ação fora daqui.
 */
export const tools: Anthropic.Tool[] = [
  {
    name: "open_app",
    description: "Abre um app no iPhone pelo nome ou bundle id conhecido.",
    input_schema: {
      type: "object",
      properties: {
        appName: { type: "string", description: "Nome do app, ex: 'Spotify'." },
      },
      required: ["appName"],
    },
  },
  {
    name: "create_reminder",
    description: "Cria um lembrete no app Lembretes.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        dueDate: {
          type: "string",
          description: "Data/hora ISO 8601, opcional.",
        },
        notes: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "create_calendar_event",
    description: "Cria um evento no Calendário.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        startDate: { type: "string", description: "ISO 8601" },
        endDate: { type: "string", description: "ISO 8601" },
        location: { type: "string" },
      },
      required: ["title", "startDate", "endDate"],
    },
  },
  {
    name: "compose_message",
    description:
      "Abre a tela de composição de mensagem pré-preenchida para um contato. " +
      "O envio final ainda exige um toque do usuário (limite da Apple).",
    input_schema: {
      type: "object",
      properties: {
        contact: { type: "string" },
        body: { type: "string" },
      },
      required: ["contact", "body"],
    },
  },
  {
    name: "set_volume",
    description: "Ajusta o volume do sistema (0.0 a 1.0).",
    input_schema: {
      type: "object",
      properties: {
        level: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["level"],
    },
  },
  {
    name: "control_home_device",
    description: "Liga/desliga ou ajusta um acessório HomeKit já pareado.",
    input_schema: {
      type: "object",
      properties: {
        deviceName: { type: "string" },
        action: { type: "string", enum: ["on", "off", "toggle"] },
      },
      required: ["deviceName", "action"],
    },
  },
  {
    name: "web_search",
    description: "Pesquisa algo na web e resume o resultado.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "subscribe_service",
    description:
      "Assina um serviço/plano pago (ex: assinatura de app, streaming). " +
      "SEMPRE sensível — exige aprovação explícita do usuário.",
    input_schema: {
      type: "object",
      properties: {
        serviceName: { type: "string" },
        plan: { type: "string" },
        priceDescription: { type: "string" },
      },
      required: ["serviceName"],
    },
  },
  {
    name: "make_purchase",
    description:
      "Compra um produto/serviço. SEMPRE sensível — exige aprovação explícita.",
    input_schema: {
      type: "object",
      properties: {
        item: { type: "string" },
        priceDescription: { type: "string" },
        store: { type: "string" },
      },
      required: ["item"],
    },
  },
  {
    name: "delete_data",
    description:
      "Apaga dados permanentemente (conta, arquivos sem lixeira, etc). " +
      "SEMPRE sensível — exige aprovação explícita.",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        scope: { type: "string" },
      },
      required: ["target"],
    },
  },
];

export const toolNames = tools.map((t) => t.name);
