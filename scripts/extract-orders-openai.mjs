import fs from "node:fs";
import path from "node:path";

const DEFAULT_INPUT = "data/imported/order-candidates.json";
const DEFAULT_OUTPUT = "data/imported/extracted-orders.json";
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_API_URL = process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses";

const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(args.input ?? DEFAULT_INPUT);
const outputPath = path.resolve(args.output ?? DEFAULT_OUTPUT);
const limit = args.limit ? Number(args.limit) : Infinity;
const offset = args.offset ? Number(args.offset) : 0;
const dryRun = Boolean(args["dry-run"]);
const model = args.model ?? DEFAULT_MODEL;

const ORDER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    source_candidate_id: { type: "string" },
    is_order: { type: "boolean" },
    order_type: {
      type: "string",
      enum: ["new_order", "order_update", "price_request", "payment_or_logistics", "not_order"]
    },
    customer: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: ["string", "null"] },
        confidence: { type: "number" },
        needs_review: { type: "boolean" }
      },
      required: ["name", "confidence", "needs_review"]
    },
    seller: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        confidence: { type: "number" }
      },
      required: ["name", "confidence"]
    },
    requested_delivery: {
      type: "object",
      additionalProperties: false,
      properties: {
        date_text: { type: ["string", "null"] },
        urgency: { type: "string", enum: ["today", "tomorrow", "this_week", "when_possible", "unknown"] }
      },
      required: ["date_text", "urgency"]
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          product_original: { type: "string" },
          product_normalized: { type: ["string", "null"] },
          quantity: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          notes: { type: ["string", "null"] },
          confidence: { type: "number" },
          needs_review: { type: "boolean" }
        },
        required: [
          "product_original",
          "product_normalized",
          "quantity",
          "unit",
          "notes",
          "confidence",
          "needs_review"
        ]
      }
    },
    notes: {
      type: "array",
      items: { type: "string" }
    },
    questions: {
      type: "array",
      items: { type: "string" }
    },
    media_processing: {
      type: "object",
      additionalProperties: false,
      properties: {
        has_audio: { type: "boolean" },
        has_images: { type: "boolean" },
        has_pdfs: { type: "boolean" },
        requires_transcription: { type: "boolean" },
        requires_image_reading: { type: "boolean" },
        filenames: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: [
        "has_audio",
        "has_images",
        "has_pdfs",
        "requires_transcription",
        "requires_image_reading",
        "filenames"
      ]
    },
    confidence: { type: "number" },
    needs_review: { type: "boolean" }
  },
  required: [
    "source_candidate_id",
    "is_order",
    "order_type",
    "customer",
    "seller",
    "requested_delivery",
    "items",
    "notes",
    "questions",
    "media_processing",
    "confidence",
    "needs_review"
  ]
};

const SYSTEM_PROMPT = `
Sos un extractor de pedidos para una empresa argentina que vende insumos para fábricas de queso y alimentos.
Tu tarea es convertir bloques de WhatsApp en JSON estructurado.

Reglas:
- No inventes cliente, productos, cantidades ni unidades.
- Si algo es dudoso, ponelo en questions y marca needs_review=true.
- El vendedor responsable normalmente es el autor del bloque.
- El cliente suele aparecer como una línea corta antes o después de los productos.
- Los productos pueden venir con errores, abreviaciones o marcas: CBP, Maraflex, Tybo, Dai FN, Lac, Oxiacetic, cloro, calcio chino, sal nitro, ácido nítrico.
- Si el bloque es sólo pago, factura, logística o consulta de precio, no lo trates como pedido confirmado.
- Si hay audio, imagen o PDF sin transcripción, marcá que requiere procesamiento de media.
- Normalizá productos suavemente: corregí errores obvios como "alacalino" -> "alcalino", pero conservá el original.
- Respondé únicamente JSON válido que cumpla el esquema.
`.trim();

function parseArgs(argv) {
  const parsed = {};

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    parsed[key] = value ?? true;
  }

  return parsed;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildUserPrompt(candidate) {
  return JSON.stringify(
    {
      source_candidate_id: candidate.id,
      seller_guess: candidate.seller_guess,
      customer_guess: candidate.customer_guess,
      start_at: candidate.start_at,
      end_at: candidate.end_at,
      heuristic_items: candidate.items,
      heuristic_notes: candidate.notes,
      attachments: candidate.attachments,
      original_text: candidate.original_text
    },
    null,
    2
  );
}

async function extractWithOpenAI(candidate) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Falta OPENAI_API_KEY. Para probar sin API, usá: npm run extract:orders:dry");
  }

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(candidate) }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "whatsapp_order_extraction",
          strict: true,
          schema: ORDER_SCHEMA
        }
      }
    })
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(`OpenAI error ${response.status}: ${JSON.stringify(body)}`);
  }

  return JSON.parse(getOutputText(body));
}

function getOutputText(response) {
  if (response.output_text) return response.output_text;

  const parts = [];
  for (const output of response.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
      if (content.type === "text" && content.text) parts.push(content.text);
    }
  }

  const text = parts.join("").trim();
  if (!text) throw new Error(`No pude encontrar output_text en la respuesta: ${JSON.stringify(response)}`);
  return text;
}

function mockExtract(candidate) {
  const attachments = candidate.attachments ?? [];
  const hasAudio = attachments.some((attachment) => attachment.kind === "audio");
  const hasImages = attachments.some((attachment) => attachment.kind === "image");
  const hasPdfs = attachments.some((attachment) => attachment.kind === "pdf");
  const items = (candidate.items ?? []).map((item) => ({
    product_original: item.product_guess,
    product_normalized: normalizeProduct(item.product_guess),
    quantity: item.quantity,
    unit: item.unit,
    notes: null,
    confidence: item.confidence,
    needs_review: item.quantity === null || item.confidence < 0.7
  }));

  return {
    source_candidate_id: candidate.id,
    is_order: items.length > 0,
    order_type: items.length > 0 ? "new_order" : "not_order",
    customer: {
      name: candidate.customer_guess,
      confidence: candidate.customer_guess ? 0.7 : 0,
      needs_review: !candidate.customer_guess
    },
    seller: {
      name: candidate.seller_guess,
      confidence: 0.9
    },
    requested_delivery: {
      date_text: null,
      urgency: guessUrgency(candidate.original_text)
    },
    items,
    notes: candidate.notes ?? [],
    questions: candidate.customer_guess ? [] : ["Confirmar cliente"],
    media_processing: {
      has_audio: hasAudio,
      has_images: hasImages,
      has_pdfs: hasPdfs,
      requires_transcription: hasAudio,
      requires_image_reading: hasImages || hasPdfs,
      filenames: attachments.map((attachment) => attachment.filename)
    },
    confidence: candidate.confidence,
    needs_review: candidate.confidence < 0.85 || hasAudio || hasImages || hasPdfs
  };
}

function normalizeProduct(value) {
  if (!value) return null;

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\balacalino\b/g, "alcalino")
    .replace(/\bbidon\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function guessUrgency(text = "") {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalized.includes("hoy")) return "today";
  if (normalized.includes("mañana") || normalized.includes("manana")) return "tomorrow";
  if (normalized.includes("esta semana")) return "this_week";
  if (normalized.includes("cuando vayamos") || normalized.includes("cuando vallamos")) return "when_possible";
  return "unknown";
}

function buildSummary(results) {
  return {
    generated_at: new Date().toISOString(),
    model: dryRun ? "dry-run" : model,
    input: inputPath,
    output: outputPath,
    count: results.length,
    needs_review: results.filter((result) => result.needs_review).length,
    with_audio: results.filter((result) => result.media_processing.has_audio).length,
    with_images: results.filter((result) => result.media_processing.has_images).length,
    not_order: results.filter((result) => !result.is_order).length
  };
}

const candidates = readJson(inputPath).slice(offset, Number.isFinite(limit) ? offset + limit : undefined);
const results = [];

for (let index = 0; index < candidates.length; index += 1) {
  const candidate = candidates[index];
  const extracted = dryRun ? mockExtract(candidate) : await extractWithOpenAI(candidate);
  results.push(extracted);

  if ((index + 1) % 10 === 0 || index === candidates.length - 1) {
    console.log(`Procesados ${index + 1}/${candidates.length}`);
  }
}

writeJson(outputPath, results);
writeJson(outputPath.replace(/\.json$/i, ".summary.json"), buildSummary(results));

console.log(`Listo: ${results.length} órdenes extraídas en ${outputPath}`);
