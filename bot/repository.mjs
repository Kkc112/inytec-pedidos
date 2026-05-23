import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { uiStatusToDb } from "../lib/order-mapping.js";

export class Repository {
  constructor() {
    this.supabase = createSupabaseClient();
    this.localDir = path.resolve("data", "live");
    fs.mkdirSync(this.localDir, { recursive: true });
  }

  get hasSupabase() {
    return Boolean(this.supabase);
  }

  async saveMessage(message) {
    appendJsonl(path.join(this.localDir, "messages.ndjson"), message);

    if (!this.supabase) return null;

    const { data, error } = await this.supabase
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

    for (const attachment of message.attachments) {
      const { error: mediaError } = await this.supabase.from("media_files").insert({
        whatsapp_message_id: data.id,
        filename: attachment.filename,
        kind: attachment.kind,
        storage_path: attachment.localPath,
        mime_type: attachment.mimeType
      });
      if (mediaError) throw mediaError;
    }

    return data.id;
  }

  async saveOrder(block, detection) {
    const order = {
      external_id: block.id,
      customer_name: detection.customerGuess ?? "Sin cliente",
      seller_name: block.authorName,
      status: uiStatusToDb(detection.needsReview ? "review" : "new"),
      notes: detection.notes.join("\n") || null,
      source_summary: "whatsapp_live",
      original_text: block.text,
      confidence: Number(detection.confidence.toFixed(3)),
      needs_review: detection.needsReview,
      media: buildMedia(block),
      created_at: block.startedAt,
      updated_at: new Date().toISOString()
    };

    appendJsonl(path.join(this.localDir, "orders.ndjson"), {
      ...order,
      items: detection.items
    });

    if (!this.supabase) return;

    const { data, error } = await this.supabase
      .from("orders")
      .upsert(order, { onConflict: "external_id" })
      .select("id")
      .single();

    if (error) throw error;

    await this.supabase.from("order_items").delete().eq("order_id", data.id);

    if (detection.items.length) {
      const { error: itemError } = await this.supabase.from("order_items").insert(
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
}

function createSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function appendJsonl(filePath, value) {
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
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
