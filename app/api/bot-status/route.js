const DEFAULT_BOT_STATUS_URL = "https://inytec-pedido-production.up.railway.app/status.json";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(process.env.BOT_STATUS_URL || DEFAULT_BOT_STATUS_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000)
    });

    if (!response.ok) throw new Error("Bot status unavailable");

    const status = await response.json();
    return Response.json(status, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json(
      { connected: false, status: "Sin conexion", group: null },
      { headers: { "cache-control": "no-store" } }
    );
  }
}
