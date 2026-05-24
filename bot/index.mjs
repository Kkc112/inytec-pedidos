import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  getContentType,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";
import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { loadDotEnv } from "./env.mjs";
import { detectOrder } from "./order-heuristics.mjs";
import { Repository } from "./repository.mjs";

loadDotEnv();

const AUTH_DIR = process.env.BOT_AUTH_DIR || "data/baileys-auth";
const MEDIA_DIR = process.env.BOT_MEDIA_DIR || "data/live/media";
const GROUP_JID = process.env.WHATSAPP_GROUP_JID;
const GROUP_NAME = process.env.WHATSAPP_GROUP_NAME;
const DEFAULT_PAIRING_PHONE = "5493534112346";
const PAIRING_PHONE = (process.env.BOT_PAIRING_PHONE || DEFAULT_PAIRING_PHONE).replace(/\D/g, "");
const BLOCK_WINDOW_MS = Number(process.env.BOT_BLOCK_WINDOW_MS || 8 * 60 * 1000);
const DEBOUNCE_MS = Number(process.env.BOT_ORDER_DEBOUNCE_MS || 30 * 1000);

const logger = pino({ level: process.env.BOT_LOG_LEVEL || "silent" });
const repository = new Repository();
const blocks = new Map();

fs.mkdirSync(MEDIA_DIR, { recursive: true });

connect();

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const sock = makeWASocket({
    auth: state,
    logger,
    browser: ["Inytec Pedidos", "Chrome", "1.0.0"],
    printQRInTerminal: false
  });

  let pairingCodeRequested = false;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (PAIRING_PHONE && !sock.authState.creds.registered && !pairingCodeRequested) {
        pairingCodeRequested = true;
        try {
          const code = await sock.requestPairingCode(PAIRING_PHONE);
          console.log(`Codigo de vinculacion WhatsApp: ${code}`);
          console.log("En WhatsApp Business: Dispositivos vinculados > Vincular con numero de telefono.");
        } catch (error) {
          pairingCodeRequested = false;
          console.error("No se pudo generar codigo de vinculacion:", error.message);
        }
      } else if (!PAIRING_PHONE) {
        console.log("Escaneá este QR con WhatsApp Business > Dispositivos vinculados:");
        qrcode.generate(qr, { small: true });
      }
    }

    if (connection === "open") {
      console.log("Bot conectado. Modo silencioso activo.");
      console.log(repository.hasSupabase ? "Destino: Supabase" : "Destino: archivos locales en data/live");
      await printGroupHints(sock);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`Conexión cerrada. Reintentar: ${shouldReconnect}`);
      if (!shouldReconnect) {
        console.log("Sesion WhatsApp invalida. Limpiando credenciales para generar una nueva vinculacion.");
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        fs.mkdirSync(AUTH_DIR, { recursive: true });
        setTimeout(connect, 3000);
        return;
      }
      if (shouldReconnect) connect();
    }
  });

  sock.ev.on("messages.upsert", async (event) => {
    for (const message of event.messages) {
      try {
        await handleMessage(sock, message);
      } catch (error) {
        console.error("Error procesando mensaje:", error.message);
      }
    }
  });
}

async function printGroupHints(sock) {
  if (GROUP_JID || GROUP_NAME) {
    console.log(`Filtro de grupo: ${GROUP_JID || GROUP_NAME}`);
    return;
  }

  const groups = await sock.groupFetchAllParticipating().catch(() => ({}));
  const names = Object.values(groups).map((group) => `${group.subject} | ${group.id}`);

  console.log("Sin filtro WHATSAPP_GROUP_NAME/WHATSAPP_GROUP_JID. Se procesarán todos los grupos donde esté el número.");
  if (names.length) {
    console.log("Grupos disponibles:");
    for (const name of names) console.log(`- ${name}`);
  }
}

async function handleMessage(sock, message) {
  if (!message.message || message.key.fromMe) return;

  const chatId = message.key.remoteJid;
  if (!chatId?.endsWith("@g.us")) return;
  if (!(await shouldProcessGroup(sock, chatId))) return;

  const normalized = await normalizeIncomingMessage(sock, message);
  if (!normalized.body && normalized.attachments.length === 0) return;

  await repository.saveMessage(normalized);
  console.log(`Mensaje recibido de ${normalized.authorName}: ${normalized.body.slice(0, 80).replace(/\n/g, " | ")}`);
  queueBlock(normalized);
}

async function shouldProcessGroup(sock, chatId) {
  if (GROUP_JID) return chatId === GROUP_JID;
  if (!GROUP_NAME) return true;

  const metadata = await sock.groupMetadata(chatId).catch(() => null);
  return metadata?.subject?.toLowerCase().includes(GROUP_NAME.toLowerCase());
}

async function normalizeIncomingMessage(sock, message) {
  const content = unwrapMessage(message.message);
  const contentType = getContentType(content);
  const body = extractText(content, contentType);
  const participant = message.key.participant || message.participant || message.key.remoteJid;
  const timestamp = Number(message.messageTimestamp || Date.now() / 1000);
  const sentAt = new Date(timestamp * 1000).toISOString();
  const authorName = message.pushName || participant;
  const externalId = `${message.key.remoteJid}:${message.key.id}`;
  const attachments = await extractAttachments(sock, message, contentType);

  return {
    externalId,
    chatId: message.key.remoteJid,
    messageId: message.key.id,
    authorId: participant,
    authorName,
    sentAt,
    body,
    attachments,
    raw: {
      key: message.key,
      pushName: message.pushName,
      contentType
    }
  };
}

function unwrapMessage(message) {
  if (message.ephemeralMessage?.message) return unwrapMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return unwrapMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return unwrapMessage(message.viewOnceMessageV2.message);
  return message;
}

function extractText(content, contentType) {
  if (!contentType) return "";

  const value = content[contentType];
  if (contentType === "conversation") return value || "";
  if (typeof value === "string") return value;

  return value?.text || value?.caption || value?.fileName || "";
}

async function extractAttachments(sock, message, contentType) {
  const mediaTypes = new Set(["audioMessage", "imageMessage", "videoMessage", "documentMessage", "stickerMessage"]);
  if (!mediaTypes.has(contentType)) return [];

  const content = unwrapMessage(message.message);
  const payload = content[contentType] || {};
  const mimeType = payload.mimetype || guessMimeType(contentType);
  const kind = mediaKind(contentType, mimeType);
  const extension = extensionFor(contentType, mimeType);
  const filename = `${message.key.id}.${extension}`;
  const localPath = path.join(MEDIA_DIR, filename);

  try {
    const buffer = await downloadMediaMessage(
      message,
      "buffer",
      {},
      {
        logger,
        reuploadRequest: sock.updateMediaMessage
      }
    );
    fs.writeFileSync(localPath, buffer);
  } catch (error) {
    console.error(`No pude descargar adjunto ${filename}: ${error.message}`);
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
  if (contentType === "audioMessage") return "audio";
  if (contentType === "imageMessage" || contentType === "stickerMessage") return "image";
  if (mimeType === "application/pdf") return "pdf";
  return "file";
}

function guessMimeType(contentType) {
  const map = {
    audioMessage: "audio/ogg",
    imageMessage: "image/jpeg",
    videoMessage: "video/mp4",
    documentMessage: "application/octet-stream",
    stickerMessage: "image/webp"
  };
  return map[contentType] || "application/octet-stream";
}

function extensionFor(contentType, mimeType) {
  if (mimeType?.includes("pdf")) return "pdf";
  if (mimeType?.includes("png")) return "png";
  if (mimeType?.includes("webp")) return "webp";
  if (mimeType?.includes("mp4")) return "mp4";
  if (mimeType?.includes("ogg") || mimeType?.includes("opus")) return "opus";
  if (contentType === "audioMessage") return "opus";
  if (contentType === "imageMessage") return "jpg";
  return "bin";
}
