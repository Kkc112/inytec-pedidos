import fs from "node:fs";
import path from "node:path";
import { detectOrder, normalize } from "../bot/order-heuristics.mjs";

const inputPath = path.resolve(process.argv[2] || "data/imported/blocks.json");
const outputDir = path.resolve(process.argv[3] || "data/analysis");
const blocks = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const detected = blocks
  .map((block) => ({ block, order: detectOrder(block) }))
  .filter((entry) => entry.order);

const customers = buildRows(
  detected.map(({ order }) => order.customerGuess).filter(Boolean),
  detected,
  (entry) => (entry.order.customerGuess ? [normalize(entry.order.customerGuess)] : [])
);
const products = buildRows(
  detected.flatMap(({ order }) => order.items.map((item) => item.productNormalized)),
  detected,
  (entry) => entry.order.items.map((item) => item.productNormalized)
);
const report = {
  generated_at: new Date().toISOString(),
  source_blocks: blocks.length,
  detected_orders: detected.length,
  detected_with_customer: detected.filter(({ order }) => order.customerGuess).length,
  detected_needs_review: detected.filter(({ order }) => order.needsReview).length,
  detected_with_media: detected.filter(({ block }) => block.attachments?.length).length,
  sellers: ranked(countBy(detected.map(({ block }) => block.author))),
  top_customers: customers.slice(0, 50),
  top_products: products.slice(0, 75)
};

fs.mkdirSync(outputDir, { recursive: true });
writeJson("history-report.json", report);
writeCsv("customers-review.csv", customers);
writeCsv("products-review.csv", products);
writeMarkdown("patterns-review.md", report, detected);

console.log(`Pedidos candidatos para revision: ${report.detected_orders}`);
console.log(`Clientes candidatos: ${customers.length}`);
console.log(`Productos candidatos: ${products.length}`);
console.log(`Archivos generados: ${outputDir}`);

function buildRows(values, entries, keyFn) {
  const counts = countBy(values.map((value) => normalize(value)));
  const examples = new Map();
  for (const entry of entries) {
    for (const key of keyFn(entry)) {
      if (key && !examples.has(key)) examples.set(key, entry.block.text.replace(/\s+/g, " ").slice(0, 140));
    }
  }
  return ranked(counts).map(({ name, count }) => ({
    normalized_name: name,
    appearances: count,
    example: examples.get(name) || "",
    review_status: "revisar"
  }));
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function ranked(map) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function writeJson(filename, value) {
  fs.writeFileSync(path.join(outputDir, filename), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeCsv(filename, rows) {
  const columns = ["normalized_name", "appearances", "example", "review_status"];
  const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n");
  fs.writeFileSync(path.join(outputDir, filename), `${csv}\n`, "utf8");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function writeMarkdown(filename, report, entries) {
  const examples = entries
    .filter(({ order }) => order.customerGuess && order.items.length > 0)
    .slice(0, 12)
    .map(({ block }) => `\`\`\`\n${block.text}\n\`\`\``)
    .join("\n\n");
  const content =
    `# Revision del historial de pedidos\n\n` +
    `- Bloques analizados: ${report.source_blocks}\n` +
    `- Pedidos candidatos: ${report.detected_orders}\n` +
    `- Con cliente candidato: ${report.detected_with_customer}\n` +
    `- Requieren revision: ${report.detected_needs_review}\n` +
    `- Con adjuntos: ${report.detected_with_media}\n\n` +
    `## Ejemplos de formato real\n\n${examples}\n`;
  fs.writeFileSync(path.join(outputDir, filename), content, "utf8");
}
