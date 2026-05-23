import fs from "node:fs";
import path from "node:path";
import { uiStatusToDb } from "../../../../../lib/order-mapping";
import { createServiceSupabaseClient } from "../../../../../lib/supabase";

export async function PATCH(request, { params }) {
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
  const { error } = await supabase
    .from("orders")
    .update({
      status: uiStatusToDb(status),
      updated_at: new Date().toISOString()
    })
    .or(`id.eq.${id},external_id.eq.${id}`);

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
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
