import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import QRCode from "qrcode";
import whatsappWeb from "whatsapp-web.js";
import { loadDotEnv } from "./env.mjs";
import { detectOrder, detectStandaloneCustomer } from "./order-heuristics.mjs";
import { MediaInterpreter } from "./media-interpreter.mjs";
import { OrderLinker } from "./order-linker.mjs";
import { Repository } from "./repository.mjs";

const { Client, LocalAuth } = whatsappWeb;

loadDotEnv();

const AUTH_DIR = process.env.BOT_AUTH_DIR || "data/whatsapp-web-auth";
const SESSION_DIR = path.join(AUTH_DIR, "wwebjs");
const MEDIA_DIR = process.env.BOT_MEDIA_DIR || "data/live/media";
const GROUP_JID = process.env.WHATSAPP_GROUP_JID;
const FINAL_GROUP_NAME = "inytec I&S";
const TEST_GROUP_NAME = "Prueba Bot Pedidos";
const GROUP_NAME = productionGroupName(process.env.WHATSAPP_GROUP_NAME);
const PORT = Number(process.env.PORT || 3000);
const BLOCK_WINDOW_MS = Number(process.env.BOT_BLOCK_WINDOW_MS || 8 * 60 * 1000);
const DEBOUNCE_MS = Number(process.env.BOT_ORDER_DEBOUNCE_MS || 30 * 1000);
const ASSOCIATION_WINDOW_MS = Number(process.env.BOT_ASSOCIATION_WINDOW_MS || 3 * 60 * 1000);
const RECOVERY_WINDOW_MS = Number(process.env.BOT_RECOVERY_WINDOW_MS || 7 * 24 * 60 * 60 * 1000);
const RECONNECT_DELAY_MS = Number(process.env.BOT_RECONNECT_DELAY_MS || 5000);
const READY_FALLBACK_DELAY_MS = Number(process.env.BOT_READY_FALLBACK_DELAY_MS || 45 * 1000);
const AUTH_STUCK_RESET_MS = Number(process.env.BOT_AUTH_STUCK_RESET_MS || 90 * 1000);

const repository = new Repository();
const mediaInterpreter = new MediaInterpreter();
const blocks = new Map();
const orderLinker = new OrderLinker({ windowMs: ASSOCIATION_WINDOW_MS });
let latestQrDataUrl = null;
let latestQrUpdatedAt = null;
let whatsappStatus = "Iniciando WhatsApp Web";
let latestError = null;
let activeClient = null;
let clientGeneration = 0;
let reconnectTimer = null;
let readyFallbackTimer = null;
let authStuckTimer = null;
let readyGeneration = 0;
const activity = {
  received: 0,
  processed: 0,
  ignoredNotGroup: 0,
  ignoredWrongGroup: 0,
  ordersCreated: 0,
  ordersUpdated: 0,
  mediaInterpreted: 0,
  lastReceivedAt: null,
  lastGroupName: null,
  lastDecision: "Esperando mensajes",
  lastOrderCustomer: null
};

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
      clearReadyWatchdogs();
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
  clearStaleBrowserLocks();

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
    scheduleReadyWatchdogs(client, generation);
  });

  client.on("ready", async () => {
    if (generation !== clientGeneration) return;

    await markClientReady(client, generation, "evento ready");
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
    clearReadyWatchdogs();
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

async function markClientReady(client, generation, source) {
  if (generation !== clientGeneration || readyGeneration === generation) return;

  readyGeneration = generation;
  clearReadyWatchdogs();
  latestQrDataUrl = null;
  latestError = null;
  whatsappStatus = "Conectado";
  console.log(`Bot conectado. Modo silencioso activo. Origen: ${source}.`);
  console.log(repository.hasSupabase ? "Destino: Supabase" : "Destino: archivos locales en data/live");
  await printGroupHints(client);
  await recoverRecentCustomerAssociations();
  await repairMalformedCustomerItems();
}

function scheduleReadyWatchdogs(client, generation) {
  clearReadyWatchdogs();

  readyFallbackTimer = setTimeout(async () => {
    if (generation !== clientGeneration || whatsappStatus !== "Vinculado. Cargando chats") return;

    try {
      const state = await client.getState();
      latestError = `WhatsApp sigue cargando chats. Estado interno: ${state || "desconocido"}`;
      console.error(latestError);
    } catch (error) {
      latestError = `WhatsApp vinculado pero todavia no cargo chats: ${error.message}`;
      console.error(latestError);
    }
  }, READY_FALLBACK_DELAY_MS);

  authStuckTimer = setTimeout(async () => {
    if (generation !== clientGeneration || whatsappStatus !== "Vinculado. Cargando chats") return;

    latestError = "WhatsApp quedo vinculado sin cargar chats. Limpiando sesion para generar un nuevo QR.";
    whatsappStatus = "Sesion trabada. Generando nuevo QR";
    console.error(latestError);
    try {
      await client.destroy();
    } catch {
      // Chromium may already be closed.
    }
    activeClient = null;
    clearReadyWatchdogs();
    clearStoredSession();
    scheduleConnect(0);
  }, AUTH_STUCK_RESET_MS);
}

function clearReadyWatchdogs() {
  if (readyFallbackTimer) clearTimeout(readyFallbackTimer);
  if (authStuckTimer) clearTimeout(authStuckTimer);
  readyFallbackTimer = null;
  authStuckTimer = null;
}

function clearStoredSession() {
  try {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    console.log("Sesion local de WhatsApp limpiada.");
  } catch (error) {
    latestError = `No se pudo limpiar la sesion de WhatsApp: ${error.message}`;
    console.error(latestError);
  }
}

function clearStaleBrowserLocks() {
  const lockNames = new Set(["SingletonLock", "SingletonCookie", "SingletonSocket"]);
  if (!fs.existsSync(SESSION_DIR)) return;

  for (const entry of fs.readdirSync(SESSION_DIR, { recursive: true, withFileTypes: true })) {
    if (!lockNames.has(entry.name)) continue;
    const parentPath = entry.parentPath || entry.path;
    const lockPath = path.join(parentPath, entry.name);
    try {
      fs.rmSync(lockPath, { force: true });
      console.log(`Bloqueo anterior de navegador eliminado: ${entry.name}`);
    } catch (error) {
      console.error(`No se pudo eliminar bloqueo ${entry.name}: ${error.message}`);
    }
  }
}

function startStatusServer() {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/media/")) {
      serveMediaFile(req, res);
      return;
    }

    if (req.url === "/status.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(
        JSON.stringify({
          connected: whatsappStatus === "Conectado",
          status: whatsappStatus,
          group: GROUP_JID || GROUP_NAME || "Todos los grupos",
          lastReceivedAt: activity.lastReceivedAt,
          lastDecision: activity.lastDecision
        })
      );
      return;
    }

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
      .activity { margin: 28px auto 0; max-width: 560px; padding: 16px; border: 1px solid #d8cab6; text-align: left; background: #fff; }
      .activity p { margin: 8px 0; font-size: 15px; }
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
      <section class="activity">
        <strong>Actividad del bot</strong>
        <p>Filtro de grupo: ${escapeHtml(GROUP_JID || GROUP_NAME || "Todos los grupos")}</p>
        <p>Mensajes vistos: ${activity.received} | Procesados: ${activity.processed} | Pedidos creados: ${activity.ordersCreated} | Actualizados: ${activity.ordersUpdated}</p>
        <p>Audios o imagenes interpretados: ${activity.mediaInterpreted} | Modo de archivos: ${mediaInterpreter.enabled ? "Lectura automatica" : "Carga manual"}</p>
        <p>Guardado de archivos: ${repository.hasSupabase ? "Supabase permanente" : "Local temporal"}</p>
        <p>Ultimo grupo visto: ${escapeHtml(activity.lastGroupName || "Ninguno")}</p>
        <p>Resultado: ${escapeHtml(activity.lastDecision)}</p>
      </section>
    </main>
  </body>
</html>`);
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor de vinculacion activo. Abrir: ${publicQrUrl()}`);
  });
}

function serveMediaFile(req, res) {
  const filename = path.basename(decodeURIComponent(req.url.slice("/media/".length).split("?")[0]));
  const filePath = path.join(MEDIA_DIR, filename);
  if (!filename || !fs.existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Archivo no encontrado");
    return;
  }

  const mimeTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".opus": "audio/ogg",
    ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".pdf": "application/pdf"
  };
  const contentType = mimeTypes[path.extname(filename).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "content-type": contentType,
    "cache-control": "private, max-age=300",
    "content-disposition": `inline; filename="${filename.replaceAll('"', "")}"`
  });
  fs.createReadStream(filePath).pipe(res);
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

function productionGroupName(configuredName) {
  const selectedName = configuredName?.trim();
  if (!selectedName || selectedName.toLowerCase() === TEST_GROUP_NAME.toLowerCase()) return FINAL_GROUP_NAME;
  return selectedName;
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
  activity.received += 1;
  activity.lastReceivedAt = new Date().toISOString();
  activity.lastGroupName = chat?.isGroup ? chat.name || chatId : "Mensaje fuera de un grupo";

  if (!chat?.isGroup || !chatId?.endsWith("@g.us")) {
    activity.ignoredNotGroup += 1;
    activity.lastDecision = "Ignorado: no pertenece a un grupo";
    return;
  }
  if (!shouldProcessGroup(chat, chatId)) {
    activity.ignoredWrongGroup += 1;
    activity.lastDecision = `Ignorado: el grupo no coincide con ${GROUP_JID || GROUP_NAME}`;
    return;
  }

  let normalized = await normalizeIncomingMessage(message);
  if (!normalized.body && normalized.attachments.length === 0) return;

  const hadInterpretableMedia = normalized.attachments.some((attachment) => ["audio", "image"].includes(attachment.kind));
  normalized = await mediaInterpreter.enrichMessage(normalized);
  if (mediaInterpreter.enabled && hadInterpretableMedia) activity.mediaInterpreted += 1;

  await repository.saveMessage(normalized);
  activity.processed += 1;
  activity.lastDecision = "Procesado: esperando deteccion de pedido";
  console.log(`Mensaje recibido de ${normalized.authorName}: ${normalized.body.slice(0, 80).replace(/\n/g, " | ")}`);
  queueBlock(normalized);
}

function shouldProcessGroup(chat, chatId) {
  if (GROUP_JID) return chatId === GROUP_JID;
  if (!GROUP_NAME) return true;
  return chat.name?.trim().toLowerCase() === GROUP_NAME.toLowerCase();
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
      text: message.orderText ?? message.body
    });
  } else {
    current.messages.push(message);
    current.endedAt = message.sentAt;
    current.text = current.messages.map((item) => item.orderText ?? item.body).filter(Boolean).join("\n");
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

  const result = orderLinker.evaluate(block);
  if (result.action === "ignored") return;
  if (result.action === "customer_waiting") {
    activity.lastDecision = `Cliente recibido; esperando su pedido: ${result.customer}`;
    console.log(`Cliente recibido para asociar con un pedido: ${result.customer} (${block.authorName})`);
    return;
  }

  await repository.saveOrder(result.block, result.detection);
  activity.lastOrderCustomer = result.detection.customerGuess || "Sin cliente";
  if (result.action === "updated") {
    activity.ordersUpdated += 1;
    activity.lastDecision = `Pedido actualizado: ${activity.lastOrderCustomer}`;
    console.log(`Pedido candidato actualizado: ${activity.lastOrderCustomer} (${result.block.authorName})`);
    return;
  }

  activity.ordersCreated += 1;
  activity.lastDecision = `Pedido creado: ${activity.lastOrderCustomer}`;
  console.log(`Pedido candidato creado: ${activity.lastOrderCustomer} (${result.block.authorName})`);
}

async function recoverRecentCustomerAssociations() {
  if (!repository.hasSupabase) return;

  const since = new Date(Date.now() - RECOVERY_WINDOW_MS).toISOString();
  const incompleteOrders = await repository.findUnassignedOrdersSince(since);
  let recovered = 0;

  for (const order of incompleteOrders) {
    let text = order.original_text;
    let detection = detectOrder({ text, messages: [{ attachments: [] }] });

    if (!detection?.customerGuess) {
      const until = new Date(new Date(order.created_at).getTime() + ASSOCIATION_WINDOW_MS).toISOString();
      const messages = await repository.findMessagesAfterOrder(order, until);
      const customerMessage = messages.find((message) => detectStandaloneCustomer(message.body));
      if (!customerMessage) continue;

      text = [text, customerMessage.body].filter(Boolean).join("\n");
      detection = detectOrder({ text, messages: [{ attachments: [] }] });
    }

    if (!detection?.customerGuess) continue;
    await repository.completeOrderCustomer(order.external_id, text, detection);
    recovered += 1;
    activity.ordersUpdated += 1;
    activity.lastOrderCustomer = detection.customerGuess;
    activity.lastDecision = `Pedido recuperado: ${detection.customerGuess}`;
    console.log(`Pedido sin cliente recuperado: ${detection.customerGuess}`);
  }

  if (recovered) console.log(`Pedidos recientes completados al reconectar: ${recovered}`);
}

async function repairMalformedCustomerItems() {
  if (!repository.hasSupabase) return;

  const since = new Date(Date.now() - RECOVERY_WINDOW_MS).toISOString();
  const orders = await repository.findRecentLiveOrdersSince(since);
  let repaired = 0;

  for (const order of orders) {
    const hasCustomerAsProduct = order.order_items.some((item) => /^cliente\b/i.test(item.product_text));
    if (!hasCustomerAsProduct) continue;

    const detection = detectOrder({ text: order.original_text, messages: [{ attachments: [] }] });
    if (!detection?.items.length) continue;

    await repository.refreshOrderItems(order.external_id, detection.items);
    repaired += 1;
    console.log(`Productos corregidos en pedido: ${order.external_id}`);
  }

  if (repaired) console.log(`Pedidos con productos corregidos al reconectar: ${repaired}`);
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
