import fs from "node:fs";
import path from "node:path";
import { dbOrderToDashboardOrder, extractedOrderToDashboardOrder, groupOpenDashboardOrders, liveOrderToDashboardOrder } from "../lib/order-mapping";
import { ORDERS_OPERATION_START_AT } from "../lib/operational-settings";
import { createServiceSupabaseClient } from "../lib/supabase";
import MobileDashboard from "./mobile-dashboard";

export const dynamic = "force-dynamic";

function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
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

async function loadOrders() {
  const supabase = createServiceSupabaseClient();

  if (supabase) {
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .gte("created_at", ORDERS_OPERATION_START_AT)
      .order("created_at", { ascending: false });

    if (!error) {
      return {
        orders: groupOpenDashboardOrders(data.map(dbOrderToDashboardOrder)),
        source: "supabase"
      };
    }
  }

  const root = process.cwd();
  const extractedPath = path.join(root, "data", "imported", "extracted-orders.json");
  const candidatesPath = path.join(root, "data", "imported", "order-candidates.json");
  const livePath = path.join(root, "data", "live", "orders.ndjson");
  const liveOrders = readNdjsonIfExists(livePath).map(liveOrderToDashboardOrder);
  const liveMode = fs.existsSync(livePath);
  const extracted = readJsonIfExists(extractedPath, []);
  const candidates = readJsonIfExists(candidatesPath, []);
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const historicalOrders = extracted.map((order, index) => {
    const candidate = candidatesById.get(order.source_candidate_id);
    return {
      ...extractedOrderToDashboardOrder(order, candidate),
      id: order.source_candidate_id ?? `order_${index + 1}`
    };
  });

  return {
    source: liveMode ? "live" : "local",
    orders: [...liveOrders, ...(liveMode ? [] : historicalOrders)].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
  };
}

export default async function Page() {
  const { orders, source } = await loadOrders();
  return <MobileDashboard initialOrders={orders} source={source} />;
}
