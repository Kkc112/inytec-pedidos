import fs from "node:fs";
import path from "node:path";
import { uiStatusToDb } from "../../../../../lib/order-mapping";
import { createServiceSupabaseClient } from "../../../../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    return await patchOrderStatus(request, params);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "No se pudo guardar el estado." },
      { status: 500 }
    );
  }
}

async function patchOrderStatus(request, params) {
  const supabase = createServiceSupabaseClient();
  const { status } = await request.json();

  if (!supabase) {
    const { id } = await params;
    const updated = updateLiveOrderStatus(id, uiStatusToDb(status));

    return Response.json({
      ok: updated,
      mode: "local",
      reason: updated ? "Estado guardado en data/live/orders.ndjson." : "No encontré el pedido local."
    });
  }

  const { id } = await params;
  const dbStatus = uiStatusToDb(status);
  const ids = id.split(",").map((item) => item.trim()).filter(Boolean);
  const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

  if (dbStatus === "delivered") {
    const pendingReview = await hasPendingReview(supabase, id, ids, isUuid);
    if (pendingReview) {
      return Response.json(
        { ok: false, error: "Este pedido requiere revision. Confirmala antes de marcarlo como entregado." },
        { status: 409 }
      );
    }
  }

  const patch = {
    status: dbStatus,
    updated_at: new Date().toISOString()
  };
  const query = supabase.from("orders").update(patch);
  const filteredQuery =
    ids.length > 1 && ids.every(isUuid)
      ? query.in("id", ids)
      : isUuid(id)
        ? query.eq("id", id)
        : query.eq("external_id", id);
  const { data, error } = await filteredQuery.select("id, status");

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data?.length) return Response.json({ ok: false, error: "No se encontro el pedido." }, { status: 404 });

  await insertOrderEvents(
    supabase,
    data.map((order) => order.id),
    "status_changed",
    { status: dbStatus, actor: "Operador" }
  );

  return Response.json({ ok: true, status: dbStatus, updated: data.length });
}

async function hasPendingReview(supabase, id, ids, isUuid) {
  const query = supabase.from("orders").select("id, needs_review, confidence, media, original_text, order_items(quantity, product_normalized, product_text)");
  const filteredQuery =
    ids.length > 1 && ids.every(isUuid)
      ? query.in("id", ids)
      : isUuid(id)
        ? query.eq("id", id)
        : query.eq("external_id", id);
  const { data, error } = await filteredQuery;
  if (error || !data?.length) return false;

  return data.some((order) => {
    const media = order.media ?? {};
    if (media.review_confirmed) return false;
    return Boolean(
      order.needs_review ||
        media.has_audio ||
        media.has_images ||
        media.requires_transcription ||
        media.requires_image_reading ||
        (order.confidence ?? 1) < 0.7 ||
        (order.order_items ?? []).some((item) => !item.quantity || !item.product_normalized) ||
        hasQuantityMismatch(order)
    );
  });
}

function hasQuantityMismatch(order) {
  const text = normalizeSearchText(order.original_text);
  if (!text) return false;
  const compactText = text.replace(/\s+/g, " ");

  for (const item of order.order_items ?? []) {
    const detected = Number(item.quantity);
    if (!Number.isFinite(detected) || detected <= 0) continue;
    for (const term of itemSearchTerms(item)) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      const filler = "(?:(?:de|del|la|el|los|las|x|por|pallets?|bolsas?|litros?|lts?|lt|cajas?|pares?|par|unidades?|kg|kilos?|bidones?|tambores?)\\s+){0,4}";
      const before = new RegExp(`(?:^|\\b)(\\d+(?:[,.]\\d+)?)\\s+${filler}${escaped}\\b`, "i");
      const after = new RegExp(`\\b${escaped}\\b\\s+${filler}(\\d+(?:[,.]\\d+)?)\\b`, "i");
      const match = before.exec(compactText) ?? after.exec(compactText);
      if (!match) continue;
      const written = Number(String(match[1]).replace(",", "."));
      if (Number.isFinite(written) && Math.abs(written - detected) >= 0.01) return true;
      break;
    }
  }
  return false;
}

function itemSearchTerms(item) {
  const raw = normalizeSearchText(`${item.product_normalized ?? ""} ${item.product_text ?? ""}`);
  const words = raw
    .split(/[^a-z0-9]+/i)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !["con", "del", "las", "los", "para", "por", "una", "uno"].includes(word));
  const phrases = [normalizeSearchText(item.product_normalized), normalizeSearchText(item.product_text)]
    .filter(Boolean)
    .filter((phrase) => phrase.length > 2);
  return [...new Set([...phrases, ...words])].slice(0, 5);
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function insertOrderEvents(supabase, orderIds, eventType, payload) {
  const rows = orderIds.map((orderId) => ({
    order_id: orderId,
    event_type: eventType,
    payload
  }));
  await supabase.from("order_events").insert(rows);
}

function updateLiveOrderStatus(id, dbStatus) {
  const filePath = path.join(process.cwd(), "data", "live", "orders.ndjson");
  if (!fs.existsSync(filePath)) return false;

  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let changed = false;

  const nextLines = lines.map((line) => {
    const order = JSON.parse(line);

    if (order.external_id !== id) return line;

    changed = true;
    return JSON.stringify({
      ...order,
      status: dbStatus,
      updated_at: new Date().toISOString()
    });
  });

  if (changed) fs.writeFileSync(filePath, `${nextLines.join("\n")}\n`, "utf8");
  return changed;
}
