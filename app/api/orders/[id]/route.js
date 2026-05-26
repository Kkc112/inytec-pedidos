import fs from "node:fs";
import path from "node:path";
import { createServiceSupabaseClient } from "../../../../lib/supabase";

export async function DELETE(_request, { params }) {
  const { id } = await params;
  const supabase = createServiceSupabaseClient();

  if (!supabase) {
    const deleted = deleteLiveOrder(id);

    return Response.json(
      {
        ok: deleted,
        mode: "local",
        reason: deleted ? "Pedido eliminado." : "No se encontró el pedido."
      },
      { status: deleted ? 200 : 404 }
    );
  }

  const { error } = await supabase.from("orders").delete().eq("id", id);

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}

function deleteLiveOrder(id) {
  const filePath = path.join(process.cwd(), "data", "live", "orders.ndjson");
  if (!fs.existsSync(filePath)) return false;

  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const nextLines = lines.filter((line) => JSON.parse(line).external_id !== id);

  if (nextLines.length === lines.length) return false;

  fs.writeFileSync(filePath, nextLines.length ? `${nextLines.join("\n")}\n` : "", "utf8");
  return true;
}
