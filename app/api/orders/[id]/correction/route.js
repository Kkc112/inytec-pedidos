import { createServiceSupabaseClient } from "../../../../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    return await patchOrderCorrection(request, params);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "No se pudo guardar la correccion." },
      { status: 500 }
    );
  }
}

async function patchOrderCorrection(request, params) {
  const supabase = createServiceSupabaseClient();
  if (!supabase) return Response.json({ ok: false, error: "No hay conexion con la base." }, { status: 503 });

  const { id } = await params;
  const payload = await request.json();
  const customerName = cleanText(payload.customerName);
  const items = Array.isArray(payload.items) ? payload.items.map(cleanItem).filter(Boolean) : [];

  if (!customerName) {
    return Response.json({ ok: false, error: "El cliente es obligatorio." }, { status: 400 });
  }

  const ids = id.split(",").map((item) => item.trim()).filter(Boolean);
  const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const orderQuery = supabase.from("orders").select("id");
  const filteredOrderQuery =
    ids.length > 1 && ids.every(isUuid)
      ? orderQuery.in("id", ids)
      : isUuid(id)
        ? orderQuery.eq("id", id)
        : orderQuery.eq("external_id", id);

  const { data: orders, error: orderError } = await filteredOrderQuery;
  if (orderError) return Response.json({ ok: false, error: orderError.message }, { status: 500 });
  if (!orders?.length) return Response.json({ ok: false, error: "No se encontro el pedido." }, { status: 404 });

  const orderIds = orders.map((order) => order.id);
  const primaryOrderId = orderIds[0];
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("orders")
    .update({
      customer_name: customerName,
      needs_review: false,
      updated_at: now
    })
    .in("id", orderIds);

  if (updateError) return Response.json({ ok: false, error: updateError.message }, { status: 500 });

  const incomingIds = items.map((item) => item.id).filter(Boolean);
  const { error: deleteError } = await supabase
    .from("order_items")
    .delete()
    .in("order_id", orderIds)
    .not("id", "in", `(${incomingIds.join(",") || "00000000-0000-0000-0000-000000000000"})`);

  if (deleteError) return Response.json({ ok: false, error: deleteError.message }, { status: 500 });

  for (const item of items) {
    const patch = {
      product_text: item.productText,
      product_normalized: item.productNormalized,
      quantity: item.quantity,
      unit: item.unit,
      notes: item.notes,
      confidence: 0.95
    };

    if (item.id) {
      const { error } = await supabase.from("order_items").update(patch).eq("id", item.id).in("order_id", orderIds);
      if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
      continue;
    }

    const { error } = await supabase.from("order_items").insert({ ...patch, order_id: primaryOrderId });
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, updatedOrders: orderIds.length, savedItems: items.length });
}

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function cleanItem(item) {
  const productText = cleanText(item.productText);
  const productNormalized = cleanText(item.productNormalized) || productText.toLowerCase();
  if (!productText) return null;

  const quantity =
    item.quantity === null || item.quantity === undefined || item.quantity === ""
      ? null
      : Number(String(item.quantity).replace(",", "."));

  return {
    id: isSafeUuid(item.id) ? item.id : null,
    productText,
    productNormalized,
    quantity: Number.isFinite(quantity) ? quantity : null,
    unit: cleanText(item.unit) || null,
    notes: cleanText(item.notes) || null
  };
}

function isSafeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? "");
}
