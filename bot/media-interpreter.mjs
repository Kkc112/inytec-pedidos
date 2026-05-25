import fs from "node:fs";

const RESPONSES_URL = process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses";
const TRANSCRIPTIONS_URL = process.env.OPENAI_TRANSCRIPTIONS_URL || "https://api.openai.com/v1/audio/transcriptions";
const TRANSCRIPTION_CONTEXT =
  "Conversacion de una empresa argentina de insumos para queserias. Productos frecuentes: cloro, calcio chino, sal, soda, acido nitrico, peracetico, detergente, fecula, colorante, fermento, cofia, esponja, Tybo, Maraflex y CBP. Transcribir literalmente nombres, productos y cantidades.";

const MEDIA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    document_type: { type: "string", enum: ["order", "payment", "product_reference", "other"] },
    order_text: { type: ["string", "null"] },
    reason: { type: "string" },
    confidence: { type: "number" }
  },
  required: ["document_type", "order_text", "reason", "confidence"]
};

export class MediaInterpreter {
  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    transcriptionModel = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
    visionModel = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
    fetchFn = fetch
  } = {}) {
    this.apiKey = apiKey;
    this.transcriptionModel = transcriptionModel;
    this.visionModel = visionModel;
    this.fetchFn = fetchFn;
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  async enrichMessage(message) {
    if (!this.enabled || !message.attachments.length) return message;

    const analyses = [];
    const orderEvidence = [message.body].filter(Boolean);

    for (const attachment of message.attachments) {
      try {
        if (attachment.kind === "audio") {
          const transcript = await this.transcribeAudio(attachment);
          const interpretation = await this.interpretText(transcript);
          analyses.push({ kind: "audio", filename: attachment.filename, transcript, ...interpretation });
          if (interpretation.document_type === "order" && interpretation.order_text) {
            orderEvidence.push(interpretation.order_text);
          }
        }

        if (attachment.kind === "image") {
          const interpretation = await this.interpretImage(attachment);
          analyses.push({ kind: "image", filename: attachment.filename, ...interpretation });
          if (interpretation.document_type === "order" && interpretation.order_text) {
            orderEvidence.push(interpretation.order_text);
          }
        }
      } catch (error) {
        analyses.push({ kind: attachment.kind, filename: attachment.filename, error: error.message });
        console.error(`No pude interpretar ${attachment.filename}: ${error.message}`);
      }
    }

    return {
      ...message,
      orderText: orderEvidence.join("\n"),
      raw: {
        ...message.raw,
        mediaIntelligence: analyses
      }
    };
  }

  async transcribeAudio(attachment) {
    const form = new FormData();
    const bytes = fs.readFileSync(attachment.localPath);
    form.append("file", new Blob([bytes], { type: attachment.mimeType || "audio/ogg" }), attachment.filename);
    form.append("model", this.transcriptionModel);
    form.append("language", "es");
    form.append("prompt", TRANSCRIPTION_CONTEXT);

    const response = await this.fetchFn(TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Transcripcion OpenAI ${response.status}: ${body.error?.message || "error"}`);
    return body.text?.trim() || "";
  }

  async interpretText(transcript) {
    return this.requestInterpretation([
      {
        type: "input_text",
        text: `${analysisInstructions("audio transcripto")}\n\nTranscripcion literal:\n${transcript}`
      }
    ]);
  }

  async interpretImage(attachment) {
    const bytes = fs.readFileSync(attachment.localPath);
    const dataUrl = `data:${attachment.mimeType || "image/jpeg"};base64,${bytes.toString("base64")}`;
    return this.requestInterpretation([
      { type: "input_text", text: analysisInstructions("imagen") },
      { type: "input_image", image_url: dataUrl, detail: "high" }
    ]);
  }

  async requestInterpretation(content) {
    const response = await this.fetchFn(RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.visionModel,
        input: [{ role: "user", content }],
        text: {
          format: {
            type: "json_schema",
            name: "whatsapp_media_order",
            strict: true,
            schema: MEDIA_SCHEMA
          }
        }
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Lectura OpenAI ${response.status}: ${body.error?.message || "error"}`);
    return JSON.parse(outputText(body));
  }
}

function analysisInstructions(source) {
  return `Analiza este ${source} enviado a un grupo interno de pedidos de insumos para queserias.

En este grupo ocurren estos casos reales:
- Fotos de hojas manuscritas con un pedido: hay que leer productos y cantidades.
- Fotos de envases o etiquetas: sirven como referencia, pero no son un pedido por si solas.
- Comprobantes, facturas o pagos: nunca deben generar un pedido.
- El cliente puede no estar en el archivo y aparecer en otro mensaje inmediatamente despues.
- En audio se dictan pedidos de forma informal, con cantidades y productos.

Si es un pedido, devuelve order_text en lineas simples para procesarlo:
"<cantidad> <producto>" por cada producto, y "Cliente: <nombre>" solo si el cliente aparece de forma explicita.
No inventes cliente, producto o cantidad. Si no es un pedido, order_text debe ser null.`;
}

function outputText(response) {
  if (response.output_text) return response.output_text;
  for (const output of response.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("La respuesta no contiene texto interpretable.");
}
