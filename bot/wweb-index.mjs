import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import QRCode from "qrcode";
import whatsappWeb from "whatsapp-web.js";
import { loadDotEnv } from "./env.mjs";
import { detectOrder } from "./order-heuristics.mjs";
import { Repository } from "./repository.mjs";

const { Client, LocalAuth } = whatsappWeb;

loadDotEnv();

const AUTH_DIR = process.env.BOT_AUTH_DIR || "data/whatsapp-web-auth";
const SESSION_DIR = path.join(AUTH_DIR, "wwebjs");
const MEDIA_DIR = process.env.BOT_MEDIA_DIR || "data/live/media";
const GROUP_JID = process.env.WHATSAPP_GROUP_JID;
const GROUP_NAME = process.env.WHATSAPP_GROUP_NAME;
const PORT = Number(process.env.PORT || 3000);
const BLOCK_WINDOW_MS = Number(process.env.BOT_BLOCK_WINDOW_MS || 8 * 60 * 1000);
const DEBOUNCE_MS = Number(process.env.BOT_ORDER_DEBOUNCE_MS || 30 * 1000);
const RECONNECT_DELAY_MS = Number(process.env.BOT_RECONNECT_DELAY_MS || 5000);

const repository = new Repository();
const blocks = new Map();
let latestQrDataUrl = null;
let latestQrUpdatedAt = null;
let whatsappStatus = "Iniciando WhatsApp Web";
let latestError = null;
let activeClient = null;
let clientGeneration = 0;
let reconnectTimer = null;

fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(SESSION_DIR, { recursive: true });

process.on("unhandledRejection", (error) => {
  latestError = error?.message || String(error);
  console.error("Error no controlado en WhatsApp:", latestError);
  scheduleConnect();
});

process.on("uncaughtException", (error) => {
  latestError = error?.message || String(error);
  console.error("Excepcion no controlada en WhatsApp:", latestError);
  scheduleConnect();
});

startStatusServer();
scheduleConnect(0);

function scheduleConnect(delayMs = RECONNECT_DELAY_MS) {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (activeClient) {
      try {
        await activeClient.destroy();
      } catch {
        // Chromium may already be closed after a disconnect.
      }
      activeClient = null;
    }

    connect().catch((error) => {
      latestError = error?.message || String(error);
      console.error("No se pudo iniciar WhatsApp Web:", latestError);
      whatsappStatus = "Reintentando conexion";
      scheduleConnect();
    });
  }, delayMs);
}

async function connect() {
  const generation = ++clientGeneration;
  whatsappStatus = "Iniciando WhatsApp Web";

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: "inytec-bot",
      dataPath: path.resolve(SESSION_DIR)
    }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    }
  });

  activeClient = client;

  client.on("qr", async (qr) => {
    if (generation !== clientGeneration) return;

    latestQrDataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 520 });
    latestQrUpdatedAt = new Date().toISOString();
    latestError = null;
    whatsappStatus = "Escanear QR";
    console.log(`QR listo para escanear en: ${publicQrUrl()}`);
  });

  client.on("authenticated", () => {
    if (generation !== clientGeneration) return;
    whatsappStatus = "Vinculado. Cargando chats";
    console.log("WhatsApp acepto la vinculacion. Cargando chats.");
  });

  client.on("ready", async () => {
    if (generation !== clientGeneration) return;

    latestQrDataUrl = null;
    latestError = null;
    whatsappStatus = "Conectado";
    console.log("Bot conectado. Modo silencioso activo.");
    console.log(repository.hasSupabase ? "Destino: Supabase" : "Destino: archivos locales en data/live");
    await printGroupHints(client);
  });

  client.on("auth_failure", (message) => {
    if (generation !== clientGeneration) return;
    whatsappStatus = "Sesion rechazada";
    console.error("WhatsApp rechazo la sesion:", message);
  });

  client.on("disconnected", async (reason) => {
    if (generation !== clientGeneration) return;

    whatsappStatus = "Reconectando";
    console.log(`Conexion cerrada: ${reason}. Reintentando.`);
    activeClient = null;
    try {
      await client.destroy();
    } catch {
      // Chromium may already be closed after a disconnect.
    }
    scheduleConnect();
  });

  client.on("message", async (message) => {
    try {
      await handleMessage(message);
    } catch (error) {
      console.error("Error procesando mensaje:", error.message);
    }
  });

  await client.initialize();
}

function startStatusServer() {
  const server = http.createServer((req, res) => {
    if (req.url !== "/" && req.url !== "/qr") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Inytec Bot WhatsApp</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; background: #f6f1e8; color: #111; }
      main { width: min(92vw, 680px); text-align: center; }
      img { width: min(88vw, 520px); height: auto; background: #fff; padding: 18px; border: 1px solid #d8cab6; }
      p { font-size: 18px; line-height: 1.4; }
      .muted { color: #5f6967; font-size: 14px; }
      .error { color: #972d20; font-size: 14px; word-break: break-word; }
      .state { display: inline-block; padding: 8px 14px; border: 1px solid #d8cab6; border-radius: 999px; font-weight: 600; }
    </style>
    <script>window.setTimeout(() => window.location.reload(), 3000);</script>
  </head>
  <body>
    <main>
      <h1>Vincular bot WhatsApp</h1>
      <p class="state">${whatsappStatus}</p>
      ${
        latestQrDataUrl
          ? `<div><img src="${latestQrDataUrl}" alt="QR para vincular WhatsApp" /></div><p>Escanea este QR desde WhatsApp Business.</p><p class="muted">Se actualiza automaticamente cada 3 segundos. Actualizado: ${latestQrUpdatedAt}</p>`
          : "<p>Cuando haya un QR pendiente aparecera aqui. Si el estado dice Conectado, el bot ya esta funcionando.</p>"
      }
      ${latestError ? `<p class="error">Detalle: ${escapeHtml(latestError)}</p>` : ""}
    </main>
  </body>
</html>`);
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor de vinculacion activo. Abrir: ${publicQrUrl()}`);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function publicQrUrl() {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/qr`;
  return `http://localhost:${PORT}/qr`;
}

async function printGroupHints(client) {
  if (GROUP_JID || GROUP_NAME) {
    console.log(`Filtro de grupo: ${GROUP_JID || GROUP_NAME}`);
    return;
  }

  const chats = await client.getChats();
  const names = chats.filter((chat) => chat.isGroup).map((chat) => `${chat.name} | ${chat.id._serialized}`);

  console.log("Sin filtro de grupo. Se procesaran todos los grupos donde este el numero.");
  if (names.length) {
    console.log("Grupos disponibles:");
    for (const name of names) console.log(`- ${name}`);
  }
}

async function handleMessage(message) {
  if (message.fromMe) return;

  const chat = await message.getChat();
  const chatId = message.from;
  if (!chat?.isGroup || !chatId?.endsWith("@g.us")) return;
  if (!shouldProcessGroup(chat, chatId)) return;

  const normalized = await normalizeIncomingMessage(message);
  if (!normalized.body && normalized.attachments.length === 0) return;

  await repository.saveMessage(normalized);
  console.log(`Mensaje recibido de ${normalized.authorName}: ${normalized.body.slice(0, 80).replace(/\n/g, " | ")}`);
  queueBlock(normalized);
}

function shouldProcessGroup(chat, chatId) {
  if (GROUP_JID) return chatId === GROUP_JID;
  if (!GROUP_NAME) return true;
  return chat.name?.toLowerCase().includes(GROUP_NAME.toLowerCase());
}

async function normalizeIncomingMessage(message) {
  const contact = await message.getContact().catch(() => null);
  const contentType = message.type || "chat";
  const participant = message.author || message.from;
  const timestamp = Number(message.timestamp || Date.now() / 1000);
  const sentAt = new Date(timestamp * 1000).toISOString();
  const authorName = contact?.pushname || contact?.name || contact?.number || participant;
  const messageId = message.id?._serialized || message.id?.id || `${participant}_${timestamp}`;
  const attachments = await extractAttachments(message, contentType, messageId);

  return {
    externalId: `${message.from}:${messageId}`,
    chatId: message.from,
    messageId,
    authorId: participant,
    authorName,
    sentAt,
    body: message.body || "",
    attachments,
    raw: { from: message.from, author: message.author, messageId, contentType }
  };
}

async function extractAttachments(message, contentType, messageId) {
  if (!message.hasMedia) return [];

  const media = await message.downloadMedia().catch((error) => {
    console.error(`No pude descargar adjunto ${messageId}: ${error.message}`);
    return null;
  });
  if (!media) return [];

  const mimeType = media.mimetype || guessMimeType(contentType);
  const kind = mediaKind(contentType, mimeType);
  const extension = extensionFor(contentType, mimeType);
  const filename = `${String(messageId).replace(/[^a-zA-Z0-9_-]/g, "_")}.${extension}`;
  const localPath = path.join(MEDIA_DIR, filename);

  try {
    fs.writeFileSync(localPath, Buffer.from(media.data, "base64"));
  } catch (error) {
    console.error(`No pude guardar adjunto ${filename}: ${error.message}`);
  }

  return [{ filename, kind, mimeType, localPath }];
}

function queueBlock(message) {
  const key = `${message.chatId}:${message.authorId}`;
  const current = blocks.get(key);
  const sentAt = new Date(message.sentAt);

  if (!current || sentAt - new Date(current.endedAt) > BLOCK_WINDOW_MS) {
    if (current) flushBlock(key);

    blocks.set(key, {
      id: `live_${message.chatId}_${message.authorId}_${message.messageId}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
      chatId: message.chatId,
      authorId: message.authorId,
      authorName: message.authorName,
      startedAt: message.sentAt,
      endedAt: message.sentAt,
      messages: [message],
      text: message.body
    });
  } else {
    current.messages.push(message);
    current.endedAt = message.sentAt;
    current.text = current.messages.map((item) => item.body).filter(Boolean).join("\n");
  }

  const block = blocks.get(key);
  clearTimeout(block.timer);
  block.timer = setTimeout(() => flushBlock(key), DEBOUNCE_MS);
}

async function flushBlock(key) {
  const block = blocks.get(key);
  if (!block) return;

  clearTimeout(block.timer);
  blocks.delete(key);

  const detection = detectOrder(block);
  if (!detection) return;

  await repository.saveOrder(block, detection);
  console.log(`Pedido candidato creado: ${detection.customerGuess || "Sin cliente"} (${block.authorName})`);
}

function mediaKind(contentType, mimeType) {
  if (contentType === "audio" || contentType === "ptt") return "audio";
  if (contentType === "image" || contentType === "sticker") return "image";
  if (mimeType === "application/pdf") return "pdf";
  return "file";
}

function guessMimeType(contentType) {
  const map = {
    audio: "audio/ogg",
    ptt: "audio/ogg",
    image: "image/jpeg",
    video: "video/mp4",
    document: "application/octet-stream",
    sticker: "image/webp"
  };
  return map[contentType] || "application/octet-stream";
}

function extensionFor(contentType, mimeType) {
  if (mimeType?.includes("pdf")) return "pdf";
  if (mimeType?.includes("png")) return "png";
  if (mimeType?.includes("webp")) return "webp";
  if (mimeType?.includes("mp4")) return "mp4";
  if (mimeType?.includes("ogg") || mimeType?.includes("opus")) return "opus";
  if (contentType === "audio" || contentType === "ptt") return "opus";
  if (contentType === "image") return "jpg";
  return "bin";
}
