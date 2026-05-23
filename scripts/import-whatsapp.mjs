import fs from "node:fs";
import path from "node:path";

const [, , exportDirArg = "whatsapp_export", outputDirArg = "data/imported"] = process.argv;

const exportDir = path.resolve(exportDirArg);
const outputDir = path.resolve(outputDirArg);
const chatPath = path.join(exportDir, "_chat.txt");

const HEADER_RE =
  /^\[(\d{1,2})\/(\d{1,2})\/(\d{2}),\s+(\d{1,2}):(\d{2}):(\d{2})\s*([ap])\.\s*m\.\]\s*([^:]+):\s*(.*)$/i;
const ATTACHMENT_RE = /<adjunto:\s*([^>]+)>/gi;

const PRODUCT_WORDS = [
  "acido",
  "alcalino",
  "bicarbonato",
  "bolsa",
  "bota",
  "calcio",
  "cbp",
  "cepillo",
  "cloro",
  "cofia",
  "colorante",
  "cremoso",
  "cuajo",
  "dai",
  "delantal",
  "detergente",
  "fecula",
  "fosforico",
  "guante",
  "hipoclorito",
  "lac",
  "lactinol",
  "legia",
  "lienzo",
  "manguera",
  "maraflex",
  "nitrato",
  "nitrico",
  "oxiacetic",
  "palet",
  "pallet",
  "peracetico",
  "ph",
  "pote",
  "quimox",
  "sal",
  "sardo",
  "soda",
  "sorbato",
  "tela",
  "termometro",
  "tybo"
];

const ORDER_VERBS = [
  "agrega",
  "encargo",
  "enviame",
  "envia",
  "llevar",
  "mandame",
  "mandar",
  "necesito",
  "pedido",
  "retira",
  "sumame",
  "trae"
];

const UNITS = [
  "bolsa",
  "bolsas",
  "bidon",
  "bidones",
  "caja",
  "cajas",
  "kg",
  "kilo",
  "kilos",
  "litro",
  "litros",
  "lt",
  "lts",
  "metro",
  "metros",
  "mt",
  "mts",
  "palet",
  "pallet",
  "unidad",
  "unidades"
];

const STOP_CUSTOMER_LINES = [
  "buen dia",
  "buenas",
  "gracias",
  "hola",
  "ok",
  "si",
  "no",
  "esta semana",
  "hoy",
  "manana",
  "mañana",
  "ver precios",
  "cuando vayamos",
  "avisar",
  "facturar",
  "facturadas"
];

function normalize(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u200e/g, "")
    .replace(/\u202f/g, " ")
    .toLowerCase()
    .trim();
}

function compactSpaces(value) {
  return value.replace(/\s+/g, " ").trim();
}

function parseDate(parts) {
  const [, day, month, year, hourRaw, minute, second, meridiem] = parts;
  let hour = Number(hourRaw);

  if (meridiem.toLowerCase() === "p" && hour !== 12) hour += 12;
  if (meridiem.toLowerCase() === "a" && hour === 12) hour = 0;

  return new Date(
    2000 + Number(year),
    Number(month) - 1,
    Number(day),
    hour,
    Number(minute),
    Number(second)
  );
}

function parseChat(text) {
  const messages = [];

  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.replace(/\u200e/g, "");
    const match = line.match(HEADER_RE);

    if (match) {
      const body = match[9]?.trim() ?? "";
      messages.push({
        id: `msg_${String(messages.length + 1).padStart(6, "0")}`,
        sent_at: parseDate(match).toISOString(),
        author: match[8].trim(),
        body,
        attachments: extractAttachments(body)
      });
      continue;
    }

    if (!messages.length) continue;

    messages[messages.length - 1].body += `\n${line}`;
    messages[messages.length - 1].attachments = extractAttachments(messages[messages.length - 1].body);
  }

  return messages;
}

function extractAttachments(body) {
  return [...body.matchAll(ATTACHMENT_RE)].map((match) => {
    const filename = match[1].trim();
    const extension = path.extname(filename).replace(".", "").toLowerCase();
    const kind =
      extension === "opus"
        ? "audio"
        : ["jpg", "jpeg", "png", "webp"].includes(extension)
          ? "image"
          : extension === "pdf"
            ? "pdf"
            : "file";

    return { filename, kind };
  });
}

function groupMessages(messages, windowMinutes = 8) {
  const blocks = [];

  for (const message of messages) {
    const last = blocks[blocks.length - 1];
    const sentAt = new Date(message.sent_at);
    const minutesSinceLast = last ? (sentAt - new Date(last.end_at)) / 60000 : Infinity;

    if (last && last.author === message.author && minutesSinceLast <= windowMinutes) {
      last.messages.push(message);
      last.end_at = message.sent_at;
      last.text = compactBlockText(last.messages);
      last.attachments.push(...message.attachments);
    } else {
      blocks.push({
        id: `block_${String(blocks.length + 1).padStart(6, "0")}`,
        author: message.author,
        start_at: message.sent_at,
        end_at: message.sent_at,
        messages: [message],
        text: compactBlockText([message]),
        attachments: [...message.attachments]
      });
    }
  }

  return blocks;
}

function compactBlockText(messages) {
  return messages
    .map((message) => message.body)
    .join("\n")
    .replace(/\u200e/g, "")
    .trim();
}

function hasQuantity(line) {
  return /(^|\s|\()(\d+[.,]?\d*)(\)?)(\s*(x|kg|kilos?|lts?|litros?|cajas?|caja|bolsas?|bolsa|bidones?|bidon|mts?|metros?|palet|pallet|u\b))?/i.test(
    line
  );
}

function includesAny(text, words) {
  const normalized = normalize(text);
  return words.some((word) => normalized.includes(word));
}

function isOrderLike(block) {
  const text = normalize(block.text);
  if (/feliz cumple|gracias por los saludos|se elimino este mensaje/.test(text)) return false;

  const lines = getMeaningfulLines(block.text);
  const quantityLines = lines.filter(hasQuantity).length;
  const productLines = lines.filter((line) => includesAny(line, PRODUCT_WORDS)).length;
  const hasOrderVerb = includesAny(text, ORDER_VERBS);
  const hasMedia = block.attachments.some((attachment) => ["audio", "image", "pdf"].includes(attachment.kind));

  return quantityLines >= 1 || productLines >= 2 || (hasOrderVerb && (productLines >= 1 || hasMedia));
}

function getMeaningfulLines(text) {
  return text
    .split("\n")
    .map((line) => line.replace(ATTACHMENT_RE, "").trim())
    .filter(Boolean);
}

function parseItemLine(line) {
  const cleaned = compactSpaces(line.replace(ATTACHMENT_RE, ""));
  const normalized = normalize(cleaned);
  const productHit = includesAny(normalized, PRODUCT_WORDS);
  const quantityMatch = cleaned.match(
    /(?:^|\s|\()(?<qty>\d+[.,]?\d*)(?:\))?\s*(?<unit>cajas?|bolsas?|bid[oó]nes?|bid[oó]n|kg|kilos?|lts?|litros?|lt|mts?|metros?|palet|pallet|unidades?|u\b)?/i
  );
  const startsWithQuantity = /^\s*\(?\d+[.,]?\d*/.test(cleaned);
  const hasUnit = Boolean(quantityMatch?.groups.unit);

  if (!quantityMatch && !productHit) return null;
  if (/pedido|precio|factura|pago|retira|llevar|mandar|enviar/.test(normalized) && !productHit) return null;

  const quantity =
    quantityMatch && (startsWithQuantity || hasUnit) ? Number(quantityMatch.groups.qty.replace(",", ".")) : null;
  const unit = quantityMatch?.groups.unit ? singularizeUnit(quantityMatch.groups.unit) : null;
  let product = cleaned;

  if (quantity !== null) {
    product = product.replace(quantityMatch[0], " ");
  }

  product = cleanProductGuess(product, productHit);
  product = product.replace(/^[-*]\s*/, "").trim();

  if (!product || product.length > 90) return null;

  return {
    raw_line: cleaned,
    quantity,
    unit,
    product_guess: product,
    confidence: quantity !== null && productHit ? 0.72 : productHit ? 0.48 : 0.38
  };
}

function cleanProductGuess(product, productHit) {
  let cleaned = compactSpaces(product)
    .replace(/^(de|d|x)\s+/i, "")
    .replace(/\s+(de|x)$/i, "")
    .replace(/\s+al pedido\b/i, "")
    .replace(/\s+junto con el pedido\b/i, "")
    .trim();

  if (!productHit) return cleaned;

  const normalized = normalize(cleaned);
  const firstProduct = PRODUCT_WORDS.map((word) => {
    const match = normalized.match(new RegExp(`(^|[^a-z0-9ñ])(${escapeRegExp(word)})`, "i"));
    return match ? { word, index: match.index + match[1].length } : null;
  })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)[0];

  if (!firstProduct || firstProduct.index === 0) return cleaned;

  const originalStart = normalized.slice(0, firstProduct.index).length;
  return cleaned.slice(originalStart).replace(/^(de|d|x)\s+/i, "").trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function singularizeUnit(unit) {
  const normalized = normalize(unit);
  const map = {
    bidones: "bidon",
    bolsas: "bolsa",
    cajas: "caja",
    kilos: "kg",
    kilo: "kg",
    litros: "litro",
    lts: "litro",
    lt: "litro",
    metros: "metro",
    mts: "metro",
    mt: "metro",
    pallets: "pallet",
    unidades: "unidad",
    u: "unidad"
  };

  return map[normalized] ?? normalized;
}

function guessCustomer(lines, items) {
  const itemLines = new Set(items.map((item) => item.raw_line));
  const candidates = lines
    .filter((line) => !itemLines.has(line))
    .map((line) => compactSpaces(line.replace(ATTACHMENT_RE, "")))
    .filter(Boolean)
    .filter((line) => {
      const normalized = normalize(line);
      if (hasQuantity(normalized)) return false;
      if (includesAny(normalized, PRODUCT_WORDS)) return false;
      if (includesAny(normalized, ORDER_VERBS)) return false;
      if (STOP_CUSTOMER_LINES.some((stop) => normalized.includes(stop))) return false;
      if (/https?:|@\S+|se edito este mensaje/.test(normalized)) return false;
      return normalized.length >= 3 && normalized.length <= 48;
    });

  return candidates[candidates.length - 1] ?? null;
}

function buildOrderCandidate(block) {
  const lines = getMeaningfulLines(block.text);
  const items = lines.map(parseItemLine).filter(Boolean);
  const customer_guess = guessCustomer(lines, items);
  const notes = lines.filter((line) => {
    const normalized = normalize(line);
    return /ver precios|factur|retira|retirar|llevar|cuando vayamos|avisar|pago|direccion|mañana|manana/.test(normalized);
  });

  const mediaKinds = [...new Set(block.attachments.map((attachment) => attachment.kind))];
  const confidence =
    Math.min(0.95, 0.3 + items.length * 0.11 + (customer_guess ? 0.18 : 0) + (mediaKinds.length ? 0.08 : 0));

  return {
    id: `candidate_${block.id.replace("block_", "")}`,
    source_block_id: block.id,
    status: "needs_review",
    seller_guess: block.author,
    customer_guess,
    start_at: block.start_at,
    end_at: block.end_at,
    confidence: Number(confidence.toFixed(2)),
    items,
    notes,
    attachments: block.attachments,
    original_text: block.text,
    message_ids: block.messages.map((message) => message.id)
  };
}

function summarize(messages, blocks, candidates) {
  const byAuthor = countBy(messages, (message) => message.author);
  const byAttachmentKind = countBy(
    messages.flatMap((message) => message.attachments),
    (attachment) => attachment.kind
  );
  const frequentProducts = countBy(
    candidates.flatMap((candidate) => candidate.items.map((item) => normalize(item.product_guess))),
    (product) => product
  );

  return {
    generated_at: new Date().toISOString(),
    source: chatPath,
    message_count: messages.length,
    block_count: blocks.length,
    order_candidate_count: candidates.length,
    attachment_count: messages.reduce((sum, message) => sum + message.attachments.length, 0),
    attachments_by_kind: topEntries(byAttachmentKind, 20),
    messages_by_author: topEntries(byAuthor, 20),
    frequent_product_guesses: topEntries(frequentProducts, 50)
  };
}

function countBy(values, keyFn) {
  const counts = new Map();

  for (const value of values) {
    const key = keyFn(value);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function topEntries(map, limit) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function writeJson(filename, value) {
  fs.writeFileSync(path.join(outputDir, filename), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (!fs.existsSync(chatPath)) {
  throw new Error(`No encuentro el archivo de chat: ${chatPath}`);
}

fs.mkdirSync(outputDir, { recursive: true });

const chatText = fs.readFileSync(chatPath, "utf8");
const messages = parseChat(chatText);
const blocks = groupMessages(messages);
const orderBlocks = blocks.filter(isOrderLike);
const candidates = orderBlocks.map(buildOrderCandidate);
const summary = summarize(messages, blocks, candidates);

writeJson("messages.json", messages);
writeJson("blocks.json", blocks);
writeJson("order-candidates.json", candidates);
writeJson("summary.json", summary);

console.log(
  [
    `Mensajes leidos: ${messages.length}`,
    `Bloques generados: ${blocks.length}`,
    `Candidatos de pedido: ${candidates.length}`,
    `Salida: ${outputDir}`
  ].join("\n")
);
