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

export function normalize(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function detectOrder(block) {
  const lines = getMeaningfulLines(block.text);
  const items = lines.map(parseItemLine).filter(Boolean);
  const customerGuess = guessCustomer(lines, items);
  const notes = lines.filter((line) =>
    /ver precios|factur|retira|retirar|llevar|cuando vayamos|avisar|pago|direccion|mañana|manana/i.test(
      normalize(line)
    )
  );
  const hasMedia = block.messages.some((message) => message.attachments.length > 0);
  const looksLikeOrder = isOrderLike(block.text, items, hasMedia);

  if (!looksLikeOrder) return null;

  return {
    customerGuess,
    items,
    notes,
    needsReview: !customerGuess || hasMedia || items.some((item) => item.quantity === null),
    confidence: Math.min(0.95, 0.28 + items.length * 0.12 + (customerGuess ? 0.18 : 0) + (hasMedia ? 0.08 : 0))
  };
}

function getMeaningfulLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasQuantity(line) {
  return /(^|\s|\()(\d+[.,]?\d*)(\)?)(\s*(x|kg|kilos?|lts?|litros?|cajas?|caja|bolsas?|bolsa|bid[oó]nes?|bid[oó]n|mts?|metros?|palet|pallet|u\b))?/i.test(
    line
  );
}

function includesAny(text, words) {
  const normalized = normalize(text);
  return words.some((word) => normalized.includes(word));
}

function isOrderLike(text, items, hasMedia) {
  const normalized = normalize(text);
  if (/feliz cumple|gracias por los saludos|se elimino este mensaje/.test(normalized)) return false;

  const lines = getMeaningfulLines(text);
  const quantityLines = lines.filter(hasQuantity).length;
  const productLines = lines.filter((line) => includesAny(line, PRODUCT_WORDS)).length;
  const hasOrderVerb = includesAny(text, ORDER_VERBS);

  return items.length > 0 || quantityLines >= 1 || productLines >= 2 || (hasOrderVerb && (productLines >= 1 || hasMedia));
}

function parseItemLine(line) {
  const cleaned = line.trim();
  const normalized = normalize(cleaned);
  const productHit = includesAny(normalized, PRODUCT_WORDS);
  const quantityMatch = cleaned.match(
    /(?:^|\s|\()(?<qty>\d+[.,]?\d*)(?:\))?\s*(?<unit>cajas?|bolsas?|bid[oó]nes?|bid[oó]n|kg|kilos?|lts?|litros?|lt|mts?|metros?|palet|pallet|unidades?|u\b)?/i
  );
  const startsWithQuantity = /^\s*\(?\d+[.,]?\d*/.test(cleaned);
  const hasUnit = Boolean(quantityMatch?.groups.unit);

  if (!quantityMatch && !productHit) return null;
  if (!productHit && !startsWithQuantity && !hasUnit) return null;
  if (/pedido|precio|factura|pago|retira|llevar|mandar|enviar/.test(normalized) && !productHit) return null;

  const quantity =
    quantityMatch && (startsWithQuantity || hasUnit) ? Number(quantityMatch.groups.qty.replace(",", ".")) : null;
  const unit = quantityMatch?.groups.unit ? singularizeUnit(quantityMatch.groups.unit) : null;
  let product = cleaned;

  if (quantity !== null) product = product.replace(quantityMatch[0], " ");

  product = cleanProductGuess(product, productHit);
  if (!product || product.length > 100) return null;

  return {
    productText: product,
    productNormalized: normalizeProduct(product),
    quantity,
    unit,
    confidence: quantity !== null && productHit ? 0.72 : productHit ? 0.48 : 0.38
  };
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

function cleanProductGuess(product, productHit) {
  let cleaned = product
    .replace(/\s+/g, " ")
    .replace(/^(de|d|x)\s+/i, "")
    .replace(/\s+(de|x)$/i, "")
    .replace(/\s+al pedido\b/i, "")
    .replace(/\s+junto con el pedido\b/i, "")
    .trim();

  if (!productHit) return cleaned;

  const normalized = normalize(cleaned);
  const firstProduct = PRODUCT_WORDS.map((word) => {
    const match = normalized.match(new RegExp(`(^|[^a-z0-9ñ])(${escapeRegExp(word)})`, "i"));
    return match ? { index: match.index + match[1].length } : null;
  })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)[0];

  if (!firstProduct || firstProduct.index === 0) return cleaned;
  return cleaned.slice(firstProduct.index).replace(/^(de|d|x)\s+/i, "").trim();
}

function guessCustomer(lines, items) {
  const itemLines = new Set(items.map((item) => normalize(item.productText)));

  const candidates = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const normalized = normalize(line);
      if (itemLines.has(normalized)) return false;
      if (hasQuantity(normalized) && !/^cliente\b/.test(normalized)) return false;
      if (includesAny(normalized, PRODUCT_WORDS)) return false;
      if (includesAny(normalized, ORDER_VERBS)) return false;
      if (STOP_CUSTOMER_LINES.some((stop) => normalized.includes(stop))) return false;
      if (/https?:|@\S+|se edito este mensaje/.test(normalized)) return false;
      return normalized.length >= 3 && normalized.length <= 48;
    });

  return candidates[candidates.length - 1] ?? null;
}

function normalizeProduct(value) {
  return normalize(value).replace(/\balacalino\b/g, "alcalino");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
