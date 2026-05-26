import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { uiStatusToDb } from "../lib/order-mapping.js";

export class Repository {
  constructor() {
    this.supabase = createSupabaseClient();
    this.mediaBucket = process.env.SUPABASE_MEDIA_BUCKET || "whatsapp-media";
    this.mediaBucketReady = null;
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
      const storagePath = await this.uploadMedia(attachment);
      const { error: mediaError } = await this.supabase.from("media_files").insert({
        whatsapp_message_id: data.id,
        filename: attachment.filename,
        kind: attachment.kind,
        storage_path: storagePath,
        mime_type: attachment.mimeType
      });
      if (mediaError) throw mediaError;
    }

    return data.id;
  }

  async uploadMedia(attachment) {
    await this.ensureMediaBucket();
    const contents = fs.readFileSync(attachment.localPath);
    const { error } = await this.supabase.storage.from(this.mediaBucket).upload(attachment.filename, contents, {
      contentType: attachment.mimeType,
      upsert: true
    });
    if (error) throw error;
    return `${this.mediaBucket}/${attachment.filename}`;
  }

  async ensureMediaBucket() {
    if (this.mediaBucketReady) return this.mediaBucketReady;

    this.mediaBucketReady = this.supabase.storage.createBucket(this.mediaBucket, { public: false }).then(({ error }) => {
      if (error && !/already exists|duplicate/i.test(error.message)) throw error;
    });
    return this.mediaBucketReady;
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

  async findUnassignedOrdersSince(since) {
    if (!this.supabase) return [];

    const { data, error } = await this.supabase
      .from("orders")
      .select("external_id, customer_name, seller_name, original_text, created_at")
      .eq("source_summary", "whatsapp_live")
      .eq("customer_name", "Sin cliente")
      .gte("created_at", since)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data;
  }

  async findRecentLiveOrdersSince(since) {
    if (!this.supabase) return [];

    const { data, error } = await this.supabase
      .from("orders")
      .select("external_id, original_text, order_items(product_text)")
      .eq("source_summary", "whatsapp_live")
      .gte("created_at", since);

    if (error) throw error;
    return data;
  }

  async findMessagesAfterOrder(order, until) {
    if (!this.supabase) return [];

    const { data, error } = await this.supabase
      .from("whatsapp_messages")
      .select("body, author_name, sent_at")
      .eq("author_name", order.seller_name)
      .gte("sent_at", order.created_at)
      .lte("sent_at", until)
      .order("sent_at", { ascending: true });

    if (error) throw error;
    return data;
  }

  async completeOrderCustomer(externalId, text, detection) {
    if (!this.supabase) return;

    const { data, error } = await this.supabase
      .from("orders")
      .update({
        customer_name: detection.customerGuess,
        original_text: text,
        status: uiStatusToDb(detection.needsReview ? "review" : "new"),
        notes: detection.notes.join("\n") || null,
        confidence: Number(detection.confidence.toFixed(3)),
        needs_review: detection.needsReview,
        updated_at: new Date().toISOString()
      })
      .eq("external_id", externalId)
      .select("id")
      .single();

    if (error) throw error;
    await this.replaceOrderItems(data.id, detection.items);
  }

  async refreshOrderItems(externalId, items) {
    if (!this.supabase) return;

    const { data, error } = await this.supabase.from("orders").select("id").eq("external_id", externalId).single();
    if (error) throw error;
    await this.replaceOrderItems(data.id, items);
  }

  async replaceOrderItems(orderId, items) {
    const { error: deleteError } = await this.supabase.from("order_items").delete().eq("order_id", orderId);
    if (deleteError) throw deleteError;
    if (!items.length) return;

    const { error: itemError } = await this.supabase.from("order_items").insert(
      items.map((item) => ({
        order_id: orderId,
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

function createSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    realtime: {
      transport: WebSocket
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
