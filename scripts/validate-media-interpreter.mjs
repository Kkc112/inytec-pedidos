import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MediaInterpreter } from "../bot/media-interpreter.mjs";
import { detectOrder } from "../bot/order-heuristics.mjs";
import { OrderLinker } from "../bot/order-linker.mjs";

const tempFile = path.join(os.tmpdir(), "inytec-media-validation.opus");
fs.writeFileSync(tempFile, Buffer.from("audio"));

const audioResponses = [
  jsonResponse({ text: "Mandale dos cloro y una esponja a Don Emilio." }),
  jsonResponse({
    output_text: JSON.stringify({
      document_type: "order",
      order_text: "2 cloro\n1 esponja\nCliente: Don Emilio",
      reason: "Dictado de pedido",
      confidence: 0.93
    })
  })
];

const audio = new MediaInterpreter({ apiKey: "test", fetchFn: async () => audioResponses.shift() });
const enrichedAudio = await audio.enrichMessage(messageWith("audio", tempFile));
assert(enrichedAudio.orderText === "2 cloro\n1 esponja", "audio no debe asignar cliente antes del mensaje escrito");
assert(enrichedAudio.raw.mediaIntelligence[0].transcript.includes("Don Emilio"), "audio no conserva transcripcion");
const detectedAudio = detectOrder({ text: enrichedAudio.orderText, messages: [enrichedAudio] });
assert(detectedAudio?.customerGuess === null, "audio interpretado asigno cliente sin confirmacion escrita");
assert(detectedAudio?.needsReview === true, "pedido de audio debe quedar para revision");
const linker = new OrderLinker();
const pendingAudio = linker.evaluate(block(enrichedAudio.orderText, "Francisco", enrichedAudio));
const namedCustomer = linker.evaluate(block("Don Emilio", "Francisco", messageWith("text", tempFile), 20));
assert(pendingAudio.action === "created", "audio no genero pedido pendiente");
assert(namedCustomer.action === "updated", "cliente escrito debajo no completo el audio");
assert(namedCustomer.detection.customerGuess === "Don Emilio", "cliente escrito debajo no prevalece");

const image = new MediaInterpreter({
  apiKey: "test",
  fetchFn: async () =>
    jsonResponse({
      output_text: JSON.stringify({
        document_type: "product_reference",
        order_text: null,
        reason: "Foto de envase",
        confidence: 0.94
      })
    })
});
const enrichedImage = await image.enrichMessage(messageWith("image", tempFile));
assert(enrichedImage.orderText === "", "una foto de producto creo un pedido");

const handwrittenImage = new MediaInterpreter({
  apiKey: "test",
  fetchFn: async () =>
    jsonResponse({
      output_text: JSON.stringify({
        document_type: "order",
        order_text: "20 calcio\n20 fecula\n8 cloro\nCliente: Pechuga",
        reason: "Lista manuscrita",
        confidence: 0.9
      })
    })
});
const enrichedHandwritten = await handwrittenImage.enrichMessage(messageWith("image", tempFile));
const detectedHandwritten = detectOrder({ text: enrichedHandwritten.orderText, messages: [enrichedHandwritten] });
assert(detectedHandwritten?.items.length === 3, "foto de pedido no genero productos");
assert(detectedHandwritten?.customerGuess === "Pechuga", "foto de pedido no genero cliente");

fs.rmSync(tempFile, { force: true });
console.log("Validacion correcta: audios interpretables y fotos de referencia diferenciados.");

function messageWith(kind, localPath) {
  return {
    body: "",
    attachments: [{ kind, localPath, filename: path.basename(localPath), mimeType: kind === "audio" ? "audio/ogg" : "image/jpeg" }],
    raw: {}
  };
}

function block(text, author, message, seconds = 0) {
  const instant = new Date(Date.UTC(2026, 4, 25, 12, 0, seconds)).toISOString();
  return {
    id: `media_${author}_${seconds}`,
    chatId: "grupo@g.us",
    authorId: `${author}@lid`,
    authorName: author,
    startedAt: instant,
    endedAt: instant,
    text,
    messages: [message]
  };
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function assert(value, message) {
  if (!value) {
    console.error(`Validacion de media fallida: ${message}`);
    process.exit(1);
  }
}
