const DEFAULT_BOT_URL = "https://inytec-pedido-production.up.railway.app";

export async function GET(_request, { params }) {
  const { filename } = await params;
  const safeFilename = filename?.split("/").pop();
  if (!safeFilename || safeFilename !== filename) {
    return new Response("Archivo no valido", { status: 400 });
  }

  const botUrl = process.env.BOT_PUBLIC_URL || DEFAULT_BOT_URL;
  const source = await fetch(`${botUrl}/media/${encodeURIComponent(safeFilename)}`, { cache: "no-store" });
  if (!source.ok) return new Response("Archivo no encontrado", { status: source.status });

  return new Response(source.body, {
    headers: {
      "Content-Type": source.headers.get("content-type") || "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeFilename.replaceAll('"', "")}"`,
      "Cache-Control": "private, max-age=300"
    }
  });
}
