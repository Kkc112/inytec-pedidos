import { createServiceSupabaseClient } from "../../../../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_CARRIERS = new Set(["Miguel", "Dani", "Mariano", "Ratti", null]);

export async function PATCH(request, { params }) {
  try {
    return await patchOrderCarrier(request, params);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "No se pudo guardar el transportista." },
      { status: 500 }
    );
  }
}

async function patchOrderCarrier(request, params) {
  const supabase = createServiceSupabaseClient();
  if (!supabase) return Response.json({ ok: false, error: "No hay conexion con la base." }, { status: 503 });

  const { id } = await params;
  const payload = await request.json();
  const carrierName = normalizeCarrier(payload.carrierName);
  if (!ALLOWED_CARRIERS.has(carrierName)) {
    return Response.json({ ok: false, error: "El transportista no es valido." }, { status: 400 });
  }

  const ids = id.split(",").map((item) => item.trim()).filter(Boolean);
  const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const query = supabase.from("orders").select("id, media");
  const filteredQuery =
    ids.length > 1 && ids.every(isUuid)
      ? query.in("id", ids)
      : isUuid(id)
        ? query.eq("id", id)
        : query.eq("external_id", id);

  const { data: orders, error: orderError } = await filteredQuery;
  if (orderError) return Response.json({ ok: false, error: orderError.message }, { status: 500 });
  if (!orders?.length) return Response.json({ ok: false, error: "No se encontro el pedido." }, { status: 404 });

  for (const order of orders) {
    const media = { ...(order.media ?? {}) };
    if (carrierName) {
      media.carrier_name = carrierName;
    } else {
      delete media.carrier_name;
    }

    const { error } = await supabase
      .from("orders")
      .update({ media, updated_at: new Date().toISOString() })
      .eq("id", order.id);

    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  await insertOrderEvents(
    supabase,
    orders.map((order) => order.id),
    "carrier_changed",
    { carrierName }
  );

  return Response.json({ ok: true, carrierName, updated: orders.length });
}

function normalizeCarrier(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "miguel") return "Miguel";
  if (normalized === "dani" || normalized === "daniel") return "Dani";
  if (normalized === "mariano") return "Mariano";
  if (normalized === "ratti") return "Ratti";
  return String(value).trim();
}

async function insertOrderEvents(supabase, orderIds, eventType, payload) {
  const rows = orderIds.map((orderId) => ({
    order_id: orderId,
    event_type: eventType,
    payload
  }));
  await supabase.from("order_events").insert(rows);
}
