import { createServiceSupabaseClient } from "../../../../../../lib/supabase";

const ALLOWED_VARIANTS = new Set(["calcio chino", "calcio nedmag"]);

export async function PATCH(request, { params }) {
  const supabase = createServiceSupabaseClient();
  if (!supabase) return Response.json({ ok: false, error: "No hay conexion con la base." }, { status: 503 });

  const { id, itemId } = await params;
  const { productNormalized } = await request.json();
  if (!ALLOWED_VARIANTS.has(productNormalized)) {
    return Response.json({ ok: false, error: "La variante no es valida." }, { status: 400 });
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id")
    .or(`id.eq.${id},external_id.eq.${id}`)
    .single();
  if (orderError || !order) return Response.json({ ok: false, error: "No se encontro el pedido." }, { status: 404 });

  const { data: item, error } = await supabase
    .from("order_items")
    .update({ product_normalized: productNormalized })
    .eq("id", itemId)
    .eq("order_id", order.id)
    .in("product_normalized", ["calcio", "calcio chino", "calcio nedmag"])
    .select("id, product_normalized")
    .maybeSingle();

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!item) return Response.json({ ok: false, error: "El articulo no admite esa clasificacion." }, { status: 409 });

  await supabase.from("order_events").insert({
    order_id: order.id,
    event_type: "item_updated",
    payload: { itemId: item.id, productNormalized }
  });

  return Response.json({ ok: true, item });
}
