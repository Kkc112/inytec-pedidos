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
  const patch = {
    status: dbStatus,
    updated_at: new Date().toISOString()
  };
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  const query = supabase.from("orders").update(patch);
  const filteredQuery = isUuid ? query.eq("id", id) : query.eq("external_id", id);
  const { data, error } = await filteredQuery.select("id, status").maybeSingle();

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) return Response.json({ ok: false, error: "No se encontro el pedido." }, { status: 404 });

  return Response.json({ ok: true, status: dbStatus });
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
