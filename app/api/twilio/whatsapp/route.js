import { detectOrder } from "../../../../bot/order-heuristics.mjs";
import { uiStatusToDb } from "../../../../lib/order-mapping.js";
import { createServiceSupabaseClient } from "../../../../lib/supabase.js";

export async function POST(request) {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const rawBody = await request.text();
  const params = new URLSearchParams(rawBody);
  const message = twilioParamsToMessage(params);
  const supabase = createServiceSupabaseClient();

  if (!supabase) {
    return twiml();
  }

  try {
    const messageId = await saveMessage(supabase, message);
    await saveMedia(supabase, messageId, message.attachments);
    await maybeSaveOrder(supabase, message);
  } catch (error) {
    console.error("Error procesando webhook Twilio:", error.message);
  }

  return twiml();
}

export async function GET() {
  return Response.json({
    ok: true,
    endpoint: "twilio-whatsapp",
    expectedMethod: "POST"
  });
}

function isAuthorized(request) {
  const expected = process.env.TWILIO_WEBHOOK_TOKEN;
  if (!expected) return true;

  const url = new URL(request.url);
  return url.searchParams.get("token") === expected;
}

function twilioParamsToMessage(params) {
  const messageSid = params.get("MessageSid") || params.get("SmsMessageSid") || crypto.randomUUID();
  const from = params.get("From") || "whatsapp:unknown";
  const to = params.get("To") || "whatsapp:twilio";
  const body = params.get("Body") || "";
  const authorName = params.get("ProfileName") || from.replace(/^whatsapp:/, "");
  const sentAt = new Date().toISOString();
  const attachments = readAttachments(params, messageSid);

  return {
    externalId: `twilio_${messageSid}`,
    chatId: from,
    messageId: messageSid,
    authorId: from,
    authorName,
    sentAt,
    body,
    attachments,
    raw: Object.fromEntries(params.entries()),
    to
  };
}

function readAttachments(params, messageSid) {
  const count = Number(params.get("NumMedia") || 0);
  const attachments = [];

  for (let index = 0; index < count; index += 1) {
    const url = params.get(`MediaUrl${index}`);
    const mimeType = params.get(`MediaContentType${index}`) || "application/octet-stream";
    const extension = extensionForMime(mimeType);

    attachments.push({
      filename: `${messageSid}_${index}.${extension}`,
      kind: mediaKind(mimeType),
      localPath: url,
      mimeType
    });
  }

  return attachments;
}

async function saveMessage(supabase, message) {
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .upsert(
      {
        external_id: message.externalId,
        chat_id: message.chatId,
        author_name: message.authorName,
        sent_at: message.sentAt,
        body: message.body,
        raw: message.raw
      },
      { onConflict: "external_id" }
    )
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function saveMedia(supabase, whatsappMessageId, attachments) {
  for (const attachment of attachments) {
    const { error } = await supabase.from("media_files").insert({
      whatsapp_message_id: whatsappMessageId,
      filename: attachment.filename,
      kind: attachment.kind,
      storage_path: attachment.localPath,
      mime_type: attachment.mimeType
    });

    if (error) throw error;
  }
}

async function maybeSaveOrder(supabase, message) {
  const block = {
    id: message.externalId,
    chatId: message.chatId,
    authorId: message.authorId,
    authorName: message.authorName,
    startedAt: message.sentAt,
    endedAt: message.sentAt,
    messages: [message],
    text: message.body
  };
  const detection = detectOrder(block);

  if (!detection) return;

  const { data, error } = await supabase
    .from("orders")
    .upsert(
      {
        external_id: block.id,
        customer_name: detection.customerGuess ?? message.authorName ?? "Sin cliente",
        seller_name: "Twilio WhatsApp",
        status: uiStatusToDb(detection.needsReview ? "review" : "new"),
        notes: detection.notes.join("\n") || null,
        source_summary: "twilio_whatsapp",
        original_text: block.text,
        confidence: Number(detection.confidence.toFixed(3)),
        needs_review: detection.needsReview,
        media: buildMedia(block),
        created_at: block.startedAt,
        updated_at: new Date().toISOString()
      },
      { onConflict: "external_id" }
    )
    .select("id")
    .single();

  if (error) throw error;

  await supabase.from("order_items").delete().eq("order_id", data.id);

  if (detection.items.length) {
    const { error: itemError } = await supabase.from("order_items").insert(
      detection.items.map((item) => ({
        order_id: data.id,
        product_text: item.productText,
        product_normalized: item.productNormalized,
        quantity: item.quantity,
        unit: item.unit,
        confidence: item.confidence
      }))
    );

    if (itemError) throw itemError;
  }
}

function buildMedia(block) {
  const attachments = block.messages.flatMap((message) => message.attachments);
  return {
    has_audio: attachments.some((attachment) => attachment.kind === "audio"),
    has_images: attachments.some((attachment) => attachment.kind === "image"),
    has_pdfs: attachments.some((attachment) => attachment.kind === "pdf"),
    requires_transcription: attachments.some((attachment) => attachment.kind === "audio"),
    requires_image_reading: attachments.some((attachment) => ["image", "pdf"].includes(attachment.kind)),
    filenames: attachments.map((attachment) => attachment.filename)
  };
}

function mediaKind(mimeType) {
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  return "file";
}

function extensionForMime(mimeType) {
  if (mimeType.includes("pdf")) return "pdf";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg") || mimeType.includes("opus")) return "opus";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  return "bin";
}

function twiml() {
  return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", {
    headers: {
      "content-type": "text/xml; charset=utf-8"
    }
  });
}
