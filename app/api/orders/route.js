import fs from "node:fs";
import path from "node:path";
import { dbOrderToDashboardOrder, extractedOrderToDashboardOrder, groupOpenDashboardOrders, liveOrderToDashboardOrder } from "../../../lib/order-mapping";
import { ORDERS_OPERATION_START_AT } from "../../../lib/operational-settings";
import { createServiceSupabaseClient } from "../../../lib/supabase";

export async function GET() {
  const supabase = createServiceSupabaseClient();

  if (supabase) {
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_items(*), order_events(*)")
      .gte("created_at", ORDERS_OPERATION_START_AT)
      .order("created_at", { ascending: false });

    if (!error) {
      return Response.json({
        orders: groupOpenDashboardOrders(data.map(dbOrderToDashboardOrder)),
        source: "supabase",
        syncedAt: new Date().toISOString()
      });
    }
  }

  const extractedPath = path.join(process.cwd(), "data", "imported", "extracted-orders.json");
  const candidatesPath = path.join(process.cwd(), "data", "imported", "order-candidates.json");
  const livePath = path.join(process.cwd(), "data", "live", "orders.ndjson");
  const liveOrders = readNdjsonIfExists(livePath).map(liveOrderToDashboardOrder);
  const liveMode = fs.existsSync(livePath);

  try {
    const orders = JSON.parse(fs.readFileSync(extractedPath, "utf8"));
    const candidates = JSON.parse(fs.readFileSync(candidatesPath, "utf8"));
    const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const historicalOrders = orders.map((order) =>
      extractedOrderToDashboardOrder(order, candidatesById.get(order.source_candidate_id))
    );

    return Response.json({
      orders: [...liveOrders, ...(liveMode ? [] : historicalOrders)].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)),
      source: liveMode ? "live" : "local",
      syncedAt: new Date().toISOString()
    });
  } catch {
    return Response.json({ orders: liveOrders, source: liveMode ? "live" : "local", syncedAt: new Date().toISOString() });
  }
}

function readNdjsonIfExists(filePath) {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
