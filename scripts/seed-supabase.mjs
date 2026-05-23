import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { uiStatusToDb } from "../lib/order-mapping.js";

const inputPath = path.resolve(process.argv[2] ?? "data/imported/extracted-orders.json");
const candidatesPath = path.resolve("data/imported/order-candidates.json");

loadDotEnv();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}. Revisá .env.example.`);
  return value;
}

function initialUiStatus(order) {
  if (order.needs_review) return "review";
  if (order.order_type === "price_request") return "review";
  if (order.is_order) return "new";
  return "discarded";
}

const supabase = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const orders = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const candidates = fs.existsSync(candidatesPath) ? JSON.parse(fs.readFileSync(candidatesPath, "utf8")) : [];
const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

for (const order of orders) {
  const media = order.media_processing ?? {};
  const candidate = candidatesById.get(order.source_candidate_id);

  const { data: insertedOrder, error: orderError } = await supabase
    .from("orders")
    .upsert(
      {
        external_id: order.source_candidate_id,
        customer_name: order.customer?.name ?? "Sin cliente",
        seller_name: order.seller?.name ?? "Sin vendedor",
        status: uiStatusToDb(initialUiStatus(order)),
        notes: [...(order.notes ?? []), ...(order.questions ?? [])].join("\n") || null,
        source_summary: order.order_type,
        original_text: candidate?.original_text ?? order.original_text ?? null,
        confidence: order.confidence ?? null,
        needs_review: Boolean(order.needs_review),
        media,
        created_at: candidate?.start_at ?? undefined,
        updated_at: new Date().toISOString()
      },
      { onConflict: "external_id" }
    )
    .select("id")
    .single();

  if (orderError) throw orderError;

  await supabase.from("order_items").delete().eq("order_id", insertedOrder.id);

  if (order.items?.length) {
    const { error: itemsError } = await supabase.from("order_items").insert(
      order.items.map((item) => ({
        order_id: insertedOrder.id,
        product_text: item.product_original,
        product_normalized: item.product_normalized,
        quantity: item.quantity,
        unit: item.unit,
        notes: item.notes,
        confidence: item.confidence
      }))
    );

    if (itemsError) throw itemsError;
  }
}

console.log(`Pedidos cargados en Supabase: ${orders.length}`);

function loadDotEnv() {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
