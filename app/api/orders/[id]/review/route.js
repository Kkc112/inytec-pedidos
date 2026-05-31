import { createServiceSupabaseClient } from "../../../../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(_request, { params }) {
  try {
    return await confirmReview(params);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "No se pudo confirmar la revision." },
      { status: 500 }
    );
  }
}

async function confirmReview(params) {
  const supabase = createServiceSupabaseClient();
  if (!supabase) return Response.json({ ok: false, error: "No hay conexion con la base." }, { status: 503 });

  const { id } = await params;
  const query = supabase.from("orders").select("id, media");
  const { data: orders, error } = await filterOrderQuery(query, id);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!orders?.length) return Response.json({ ok: false, error: "No se encontro el pedido." }, { status: 404 });

  const confirmedAt = new Date().toISOString();
  for (const order of orders) {
    const media = {
      ...(order.media ?? {}),
      review_confirmed: true,
      review_confirmed_at: confirmedAt,
      review_confirmed_by: "Operador"
    };

    const { error: updateError } = await supabase
      .from("orders")
      .update({ media, needs_review: false, updated_at: confirmedAt })
      .eq("id", order.id);
    if (updateError) return Response.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  await supabase.from("order_events").insert(
    orders.map((order) => ({
      order_id: order.id,
      event_type: "review_confirmed",
      payload: { actor: "Operador" }
    }))
  );

  return Response.json({ ok: true, updated: orders.length });
}

function filterOrderQuery(query, id) {
  const ids = id.split(",").map((item) => item.trim()).filter(Boolean);
  if (ids.length > 1 && ids.every(isSafeUuid)) return query.in("id", ids);
  if (isSafeUuid(id)) return query.eq("id", id);
  return query.eq("external_id", id);
}

function isSafeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? "");
}
