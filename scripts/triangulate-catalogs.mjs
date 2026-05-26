import fs from "node:fs";
import path from "node:path";

const historyDir = path.resolve(process.argv[2] || "data/analysis");
const catalogDir = path.resolve(process.argv[3] || "data/analysis/catalog-triangulation");
const outputDir = path.resolve(process.argv[4] || catalogDir);

const PRODUCT_EQUIVALENTS = new Map([
  ["cloro", ["hipoclorito de sodio"]],
  ["calcio", ["cloruro de calcio"]],
  ["calcio chino", ["cloruro de calcio"]],
  ["nitrico", ["acido nitrico"]],
  ["acido nitrico", ["acido nitrico"]],
  ["soda", ["soda caustica"]],
  ["soda caustica", ["soda caustica"]],
  ["lejia", ["legia"]],
  ["peracetico", ["peracetico"]],
  ["oxiacetic", ["oxiacetic"]],
  ["lactinol", ["lactinol"]],
  ["fecula", ["fecula"]],
  ["cofia", ["cofia"]],
  ["detergente", ["detergente"]],
  ["nitrato", ["nitrato"]],
  ["sal nitro", ["sal nitro", "nitrato"]],
  ["cuajo", ["cuajo"]],
  ["cuajos", ["cuajo"]],
  ["botas calfor pampeana blancas", ["bota blanca calfor pampeana"]]
]);
const NON_CUSTOMER_CANDIDATES = new Set([
  "disculpa la molestia",
  "lienso",
  "se nos fue este pedido"
]);

const historyCustomers = mergeHistoricalNames(parseCsv(readRequired(path.join(historyDir, "customers-review.csv"))));
const historyProducts = mergeHistoricalNames(parseCsv(readRequired(path.join(historyDir, "products-review.csv"))));
const officialCustomers = parseOfficialCustomers(readRequired(path.join(catalogDir, "official-clients.txt")));
const officialProducts = parseOfficialProducts(readRequired(path.join(catalogDir, "official-products.txt")));

const customerRows = historyCustomers.map((entry) => matchCustomer(entry, officialCustomers));
const productRows = historyProducts.map((entry) => matchProduct(entry, officialProducts));

fs.mkdirSync(outputDir, { recursive: true });
writeJson(path.join(outputDir, "catalog-summary.json"), {
  generated_at: new Date().toISOString(),
  official_customers: officialCustomers.length,
  official_products: officialProducts.length,
  historical_customer_names: customerRows.length,
  historical_product_names: productRows.length,
  customer_matches_confident: customerRows.filter((row) => row.status === "coincidencia_clara").length,
  customer_matches_to_review: customerRows.filter((row) => row.status !== "coincidencia_clara").length,
  product_names_with_one_candidate: productRows.filter((row) => row.status === "un_articulo_candidato").length,
  product_names_requiring_equivalence_confirmation: productRows.filter(
    (row) => row.status === "confirmar_equivalencia"
  ).length,
  product_names_requiring_presentation: productRows.filter((row) => row.status === "falta_presentacion").length,
  product_names_to_review: productRows.filter((row) => row.status === "revisar_nombre").length
});
writeCsv(path.join(outputDir, "client-crosswalk.csv"), customerRows, [
  "historical_name",
  "appearances",
  "status",
  "official_code",
  "official_name",
  "alternative_matches",
  "example"
]);
writeCsv(path.join(outputDir, "product-crosswalk.csv"), productRows, [
  "historical_name",
  "appearances",
  "status",
  "candidate_count",
  "candidate_articles",
  "example"
]);
writeQuestions(path.join(outputDir, "questions-for-review.md"), customerRows, productRows);

console.log(`Clientes oficiales leidos: ${officialCustomers.length}`);
console.log(`Articulos oficiales leidos: ${officialProducts.length}`);
console.log(`Nombres de clientes del historial: ${customerRows.length}`);
console.log(`Nombres de productos del historial: ${productRows.length}`);
console.log(`Informe creado en: ${outputDir}`);

function parseOfficialCustomers(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/);
    const dateIndex = tokens.findIndex((token) => /^\d{2}\/\d{2}\/\d{4}$/.test(token));
    if (dateIndex < 1) continue;

    const left = tokens.slice(0, dateIndex).join(" ");
    const codeMatch = left.match(/^(\d+)(.*)$/);
    if (!codeMatch) continue;

    const name = codeMatch[2].trim();
    if (!/^[A-Za-zÁÉÍÓÚÑÜ]/.test(name)) continue;
    rows.push({ code: codeMatch[1], name });
  }
  return uniqueBy(rows, (row) => row.code);
}

function parseOfficialProducts(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const vat = line.match(/\s(?:21|11)%/);
    const vatIndex = vat ? vat.index + 1 : -1;
    if (vatIndex < 0) continue;

    const tokens = line.slice(0, vatIndex).trim().split(/\s+/);
    if (tokens.length < 4) continue;

    const netPrice = tokens.pop();
    const grossPrice = tokens.pop();
    if (!isMoney(netPrice) || !isMoney(grossPrice)) continue;

    const code = tokens.shift();
    if (!/^\d+$/.test(code)) continue;

    const name = tokens.join(" ").replaceAll(" .", "").trim().replace(/\.$/, "").trim();
    if (!name || name === "VARIOS") continue;
    rows.push({ code, name });
  }
  return uniqueBy(rows, (row) => row.code);
}

function isMoney(value) {
  return /^\d[\d.]*,\d{2}$/.test(value || "");
}

function matchCustomer(entry, officials) {
  const scored = officials
    .map((official) => ({ ...official, score: customerScore(entry.normalized_name, official.name) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  const directMatches = officials.filter((official) => directClientMatch(entry.normalized_name, official.name));
  const ignored = NON_CUSTOMER_CANDIDATES.has(normalize(entry.normalized_name));
  const clear = !ignored && best && directMatches.length <= 1 && isClearCustomerMatch(entry.normalized_name, best, second);
  const candidateLimit = clear ? 3 : 5;

  return {
    historical_name: entry.normalized_name,
    appearances: Number(entry.appearances),
    status: ignored ? "descartar_frase" : clear ? "coincidencia_clara" : "confirmar_cliente",
    official_code: clear ? best.code : "",
    official_name: clear ? best.name : "",
    alternative_matches: scored
      .slice(0, candidateLimit)
      .map((candidate) => `${candidate.code} ${candidate.name}`)
      .join(" | "),
    example: entry.example
  };
}

function isClearCustomerMatch(historical, best, second) {
  const a = clientKey(historical);
  const b = clientKey(best.name);
  if (a === b) return true;
  if (a.length >= 5 && (b.includes(a) || a.includes(b)) && best.score >= 0.83) return true;
  return best.score >= 0.84 && best.score - (second?.score || 0) >= 0.12;
}

function customerScore(historical, official) {
  const rawA = clientName(historical);
  const rawB = clientName(official);
  const a = clientKey(historical);
  const b = clientKey(official);
  if (rawA === rawB || compact(rawA) === compact(rawB)) return 1;
  if (rawA.length >= 3 && rawB.split(" ").includes(rawA)) return 0.98;
  if (rawA.length >= 5 && (rawB.includes(rawA) || compact(rawB).includes(compact(rawA)))) return 0.98;
  if (a === b) return 1;
  if (a.length >= 5 && (b.includes(a) || a.includes(b))) return 0.92;

  const similarity = editSimilarity(a, b);
  const tokenScore = tokenSimilarity(a, b);
  return tokenScore * 0.65 + similarity * 0.35;
}

function clientKey(value) {
  return clientName(value)
    .replace(/\b(srl|s a s|sas|sa|s a|s c c|scc|s h|sh|ltda)\b/g, " ")
    .replace(/\b(coop|cooperativa|de|del|la|los|las|y)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clientName(value) {
  return normalize(value)
    .replace(/\bnva\b/g, "nueva")
    .replace(/\boes\b/g, "oeste");
}

function directClientMatch(historical, official) {
  const a = clientName(historical);
  const b = clientName(official);
  return (
    (a.length >= 5 && (b.includes(a) || compact(b).includes(compact(a)))) ||
    (a.length >= 3 && b.split(" ").includes(a))
  );
}

function compact(value) {
  return value.replace(/[^a-z0-9]/g, "");
}

function matchProduct(entry, officials) {
  const historical = normalize(entry.normalized_name);
  const searches = PRODUCT_EQUIVALENTS.get(historical) || [historical];
  const reliesOnEquivalence = PRODUCT_EQUIVALENTS.has(historical) && !searches.includes(historical);
  let candidates = officials.filter((official) =>
    searches.some((search) => normalize(official.name).includes(search))
  );

  if (!candidates.length) {
    candidates = officials
      .map((official) => ({ ...official, score: productScore(historical, official.name) }))
      .sort((a, b) => b.score - a.score)
      .filter((official) => official.score >= 0.5)
      .slice(0, 5);
  }

  const status =
    reliesOnEquivalence && candidates.length
      ? "confirmar_equivalencia"
      : candidates.length === 1
      ? "un_articulo_candidato"
      : candidates.length > 1
        ? "falta_presentacion"
        : "revisar_nombre";

  return {
    historical_name: entry.normalized_name,
    appearances: Number(entry.appearances),
    status,
    candidate_count: candidates.length,
    candidate_articles: candidates
      .slice(0, 8)
      .map((candidate) => `${candidate.code} ${candidate.name}`)
      .join(" | "),
    example: entry.example
  };
}

function productScore(historical, official) {
  const a = normalize(historical);
  const b = normalize(official);
  return tokenSimilarity(a, b) * 0.72 + editSimilarity(a, b) * 0.28;
}

function tokenSimilarity(a, b) {
  const aTokens = new Set(a.split(" ").filter((token) => token.length > 1));
  const bTokens = new Set(b.split(" ").filter((token) => token.length > 1));
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  return overlap / Math.max(aTokens.size, 1);
}

function editSimilarity(a, b) {
  if (!a || !b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function normalize(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\blegia\b/g, "lejia")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsv(text) {
  const records = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (quoted && character === '"' && next === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(value);
      value = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some(Boolean)) records.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (value || row.length) {
    row.push(value);
    records.push(row);
  }

  const [headers, ...values] = records;
  return values.map((record) =>
    Object.fromEntries(headers.map((header, index) => [header, record[index] || ""]))
  );
}

function mergeHistoricalNames(entries) {
  const merged = new Map();
  for (const entry of entries) {
    const name = normalize(entry.normalized_name);
    if (!name) continue;
    const current = merged.get(name);
    if (current) {
      current.appearances = String(Number(current.appearances) + Number(entry.appearances));
    } else {
      merged.set(name, { ...entry, normalized_name: name });
    }
  }
  return [...merged.values()];
}

function writeQuestions(filename, customers, products) {
  const commonCustomerDoubts = customers
    .filter((row) => row.status !== "coincidencia_clara")
    .sort((a, b) => b.appearances - a.appearances)
    .slice(0, 25);
  const commonProductDoubts = products
    .filter((row) => row.status !== "un_articulo_candidato")
    .sort((a, b) => b.appearances - a.appearances)
    .slice(0, 25);

  const lines = [
    "# Dudas para confirmar antes de cargar el catalogo",
    "",
    "## Coincidencias claras de clientes",
    "",
    ...customers
      .filter((row) => row.status === "coincidencia_clara")
      .sort((a, b) => b.appearances - a.appearances)
      .slice(0, 20)
      .map((row) => `- **${row.historical_name}** (${row.appearances} veces) -> ${row.official_code} ${row.official_name}`),
    "",
    "## Clientes mencionados en el grupo",
    "",
    ...commonCustomerDoubts.filter((row) => row.status !== "descartar_frase").map(
      (row) => `- **${row.historical_name}** (${row.appearances} veces): ${row.alternative_matches || "sin candidato claro"}`
    ),
    "",
    "## Articulos mencionados en el grupo",
    "",
    "Cuando un nombre tiene varias presentaciones, el bot debe pedir o dejar pendiente la presentacion, no elegirla solo.",
    "",
    ...commonProductDoubts.map(
      (row) => `- **${row.historical_name}** (${row.appearances} veces): ${row.candidate_articles || "sin candidato claro"}`
    ),
    ""
  ];
  fs.writeFileSync(filename, lines.join("\n"), "utf8");
}

function readRequired(filename) {
  if (!fs.existsSync(filename)) throw new Error(`No se encontro el archivo necesario: ${filename}`);
  return fs.readFileSync(filename, "utf8");
}

function uniqueBy(values, keyFn) {
  const found = new Map();
  for (const value of values) found.set(keyFn(value), value);
  return [...found.values()];
}

function writeJson(filename, value) {
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeCsv(filename, rows, columns) {
  const content = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))
  ].join("\n");
  fs.writeFileSync(filename, `${content}\n`, "utf8");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
