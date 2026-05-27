import {
  canonicalCustomerName,
  canonicalProductName,
  knownCustomerName,
  productReviewReason,
  stripKnownCustomerAlias
} from "./catalog-rules.mjs";

const PRODUCT_WORDS = [
  "acido",
  "acidos",
  "agua destilada",
  "alcalino",
  "anti espumante",
  "bicarbonato",
  "bandeja",
  "barra",
  "barras",
  "bolsa",
  "bolsas",
  "bota",
  "botas",
  "calcio",
  "calcios",
  "cbp",
  "cepillo",
  "cloro",
  "cloros",
  "cofia",
  "cofias",
  "coagulante",
  "colador",
  "colorante",
  "cremoso",
  "cuchara",
  "cuajo",
  "dai",
  "delantal",
  "delantales",
  "detergente",
  "detergentes",
  "espatula",
  "esponja",
  "esponjas",
  "faja",
  "fecula",
  "feculas",
  "fermento",
  "fermentos",
  "fosforico",
  "guante",
  "hipoclorito",
  "ibc",
  "ibcs",
  "lac",
  "lactico",
  "lactinol",
  "legia",
  "lienzo",
  "manguera",
  "maraflex",
  "molde",
  "nitrato",
  "nitrico",
  "nitricos",
  "oxiacetic",
  "palet",
  "pallet",
  "pallets",
  "peracetico",
  "peraceticos",
  "ph",
  "ph4",
  "ph7",
  "pintura",
  "pote",
  "quimosina",
  "quimo",
  "quimox",
  "removil",
  "ricotta",
  "rociador",
  "rolac",
  "sal",
  "sardo",
  "soda",
  "sodas",
  "sorbato",
  "tela",
  "termometro",
  "tybo"
];

const ORDER_VERBS = [
  "agrega",
  "agregar",
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
  "trae",
  "traer"
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
  "ver precios",
  "cuando vayamos",
  "avisar",
  "facturar",
  "facturadas",
  "pago",
  "pagos",
  "hablar con"
];

const UNIT_PATTERN =
  "cajas?|bolsas?|bidones?|bidon|ibcs?|kg|kilos?|lts?|litros?|lt|mts?|metros?|palets?|pallets?|unidades?|u\\b";

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
  const items = lines.flatMap(parseItemLines);
  const customerGuess = guessCustomer(lines, items);
  const contextualNotes = lines.filter((line) =>
    /ver precios|factur|retira|retirar|llevar|cuando vayamos|avisar|pago|direccion|manana/i.test(normalize(line))
  );
  const productNotes = [...new Set(items.map((item) => productReviewReason(item.productNormalized)).filter(Boolean))];
  const notes = [...contextualNotes, ...productNotes];
  const hasMedia = block.messages.some((message) => message.attachments.length > 0);

  if (!isOrderLike(block.text, items, hasMedia)) return null;

  return {
    customerGuess,
    items,
    notes,
    needsReview: !customerGuess || hasMedia || items.some((item) => item.quantity === null) || productNotes.length > 0,
    confidence: Math.min(0.95, 0.28 + items.length * 0.12 + (customerGuess ? 0.18 : 0) + (hasMedia ? 0.08 : 0))
  };
}

export function detectStandaloneCustomer(text) {
  const lines = getMeaningfulLines(text);
  if (lines.length !== 1) return null;

  const line = lines[0];
  const normalized = normalize(line);
  const knownCustomer = knownCustomerName(line);
  if (knownCustomer) return knownCustomer;

  if (includesAny(normalized, PRODUCT_WORDS) || includesAny(normalized, ORDER_VERBS)) return null;
  if (hasQuantity(normalized) && !/^cliente\b/.test(normalized)) return null;
  if (/https?:|@\S+|se edito este mensaje|adjunto|foto|audio/.test(normalized)) return null;
  if (/^(ok|listo|dale|si|no|gracias|hola|buen dia|buenas|confirmado|perfecto)$/.test(normalized)) return null;
  if (/factur|pago|transfer|comprobante|precio|entrega|llevar|retira/.test(normalized)) return null;

  return normalized.length >= 3 && normalized.length <= 48 ? cleanCustomerGuess(line) : null;
}

function getMeaningfulLines(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/<adjunto:\s*[^>]+>/gi, "").trim())
    .filter(Boolean);
}

function hasQuantity(line) {
  return new RegExp(`(^|\\s|\\()(\\d+[.,]?\\d*)(\\)?)(\\s*(${UNIT_PATTERN}))?`, "i").test(line);
}

function includesAny(text, words) {
  const normalized = normalize(text);
  return words.some((word) => containsTerm(normalized, word));
}

function containsTerm(normalizedText, term) {
  const normalizedTerm = normalize(term);
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedTerm)}([^a-z0-9]|$)`, "i").test(normalizedText);
}

function isOrderLike(text, items, hasMedia) {
  const normalized = normalize(text);
  if (/feliz cumple|gracias por los saludos|se elimino este mensaje/.test(normalized)) return false;

  const lines = getMeaningfulLines(text);
  const productLines = lines.filter((line) => includesAny(line, PRODUCT_WORDS)).length;
  const hasOrderVerb = includesAny(text, ORDER_VERBS);
  const hasKnownProductItem = items.some((item) => includesAny(item.productText, PRODUCT_WORDS));
  const administrativeOnly =
    /comprobante|transferencia|echeq|ticket\.pdf|factura|pago/.test(normalized) &&
    !hasKnownProductItem &&
    !hasOrderVerb;

  if (administrativeOnly) return false;
  return hasKnownProductItem || productLines >= 2 || (hasOrderVerb && (items.length > 0 || productLines > 0 || hasMedia));
}

function parseItemLines(line) {
  const combined = parseCombinedIbcLine(line);
  if (combined.length) return combined;

  const item = parseItemLine(line);
  return item ? [item] : [];
}

function parseCombinedIbcLine(line) {
  const normalized = normalize(line);
  const ibcMatch = normalized.match(/(?:^|\s)(?:un|una|1)?\s*ibc\s+(?:de\s+)?(?<chemical>cloro|hipoclorito|nitrico|acido nitrico|peracetico|detergente)\b/);
  const trailingBoxMatch = line.match(/(?<product>guantes?.*?)\s+(?<qty>\d+[.,]?\d*)\s*(?<unit>cajas?|bolsas?|unidades?|u\b)\s*$/i);

  if (!ibcMatch || !trailingBoxMatch) return [];

  return [
    {
      productText: ibcMatch.groups.chemical,
      productNormalized: normalizeProduct(ibcMatch.groups.chemical),
      quantity: 1,
      unit: "ibc",
      confidence: 0.72
    },
    {
      productText: trailingBoxMatch.groups.product.trim(),
      productNormalized: normalizeProduct(trailingBoxMatch.groups.product),
      quantity: Number(trailingBoxMatch.groups.qty.replace(",", ".")),
      unit: singularizeUnit(trailingBoxMatch.groups.unit),
      confidence: 0.72
    }
  ];
}

function parseItemLine(line) {
  const cleaned = line.trim();
  const quantityCleaned = cleaned.replace(/^\s*una?\s+/i, "1 ");
  const normalized = normalize(cleaned);
  const withoutLeadingQuantity = normalized.replace(/^\(?\d+[.,]?\d*\)?\s*/, "");
  const productHit = includesAny(normalized, PRODUCT_WORDS) || includesAny(withoutLeadingQuantity, PRODUCT_WORDS);
  const leadingQuantityMatch = quantityCleaned.match(
    new RegExp(`^\\s*\\(?(?<qty>\\d+[.,]?\\d*)(?:\\))?\\s*(?<unit>${UNIT_PATTERN})?`, "i")
  );
  const unitQuantityMatch = quantityCleaned.match(
    new RegExp(`(?:^|\\s|\\()(?<qty>\\d+[.,]?\\d*)(?:\\))?\\s*(?<unit>${UNIT_PATTERN})`, "i")
  );
  const trailingQuantityMatch = quantityCleaned.match(/^(?<product>.+?)\s+(?<qty>\d+[.,]?\d*)\s*$/i);
  const trailingProductHit =
    trailingQuantityMatch && includesAny(trailingQuantityMatch.groups.product, PRODUCT_WORDS)
      ? trailingQuantityMatch
      : null;
  const ibcPresentationMatch = quantityCleaned.match(/^\s*(?<qty>\d+[.,]?\d*)?\s*(?<unit>ibcs?|ibc)\s+(?:de\s+)?(?<product>.+)$/i);
  const quantityMatch = leadingQuantityMatch || unitQuantityMatch || trailingProductHit;
  const startsWithQuantity = /^\s*\(?\d+[.,]?\d*/.test(cleaned);
  const hasUnit = Boolean(quantityMatch?.groups.unit);
  const hasTrailingQuantity = quantityMatch === trailingProductHit;
  const hasIbcPresentation = Boolean(ibcPresentationMatch);

  if (!quantityMatch && !productHit && !hasIbcPresentation) return null;
  if (!productHit && !startsWithQuantity && !hasUnit) return null;
  if (/pedido|precio|factura|pago|retira|llevar|mandar|enviar/.test(normalized) && !productHit) return null;

  const quantity =
    hasIbcPresentation && !quantityMatch
      ? Number((ibcPresentationMatch.groups.qty ?? "1").replace(",", "."))
      :
    quantityMatch && (startsWithQuantity || hasUnit || hasTrailingQuantity)
      ? Number(quantityMatch.groups.qty.replace(",", "."))
      : null;
  const unit = ibcPresentationMatch?.groups.unit
    ? singularizeUnit(ibcPresentationMatch.groups.unit)
    : quantityMatch?.groups.unit
      ? singularizeUnit(quantityMatch.groups.unit)
      : null;
  let product = cleaned;

  if (quantity !== null) {
    product = hasIbcPresentation
      ? ibcPresentationMatch.groups.product
      : hasTrailingQuantity
        ? quantityMatch.groups.product
        : quantityCleaned.replace(quantityMatch[0], " ");
  }

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
    ibcs: "ibc",
    ibc: "ibc",
    kilos: "kg",
    kilo: "kg",
    litros: "litro",
    lts: "litro",
    lt: "litro",
    metros: "metro",
    mts: "metro",
    mt: "metro",
    palets: "pallet",
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

  cleaned = stripKnownCustomerAlias(cleaned);

  if (!productHit) return cleaned;

  const normalized = normalize(cleaned);
  const firstProduct = PRODUCT_WORDS.map((word) => {
    const match = normalized.match(new RegExp(`(^|[^a-z0-9])(${escapeRegExp(normalize(word))})([^a-z0-9]|$)`, "i"));
    return match ? { index: match.index + match[1].length } : null;
  })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)[0];

  if (!firstProduct || firstProduct.index === 0) return cleaned;
  return cleaned.slice(firstProduct.index).replace(/^(de|d|x)\s+/i, "").trim();
}

function guessCustomer(lines, items) {
  const itemLines = new Set(items.map((item) => normalize(item.productText)));
  const knownCustomers = lines.map((line) => knownCustomerName(line)).filter(Boolean);
  if (knownCustomers.length) return knownCustomers[knownCustomers.length - 1];

  const candidates = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const normalized = normalize(line);
      if (itemLines.has(normalized)) return false;
      if (hasQuantity(normalized) && !/^cliente\b/.test(normalized)) return false;
      if (includesAny(normalized, PRODUCT_WORDS)) return false;
      if (includesAny(normalized, ORDER_VERBS)) return false;
      if (STOP_CUSTOMER_LINES.some((stop) => normalized.includes(stop)) && !/^cliente\b/.test(normalized)) return false;
      if (/https?:|@\S+|se edito este mensaje/.test(normalized)) return false;
      return normalized.length >= 3 && normalized.length <= 48;
    });

  return candidates.length ? cleanCustomerGuess(candidates[candidates.length - 1]) : null;
}

function cleanCustomerGuess(value) {
  return canonicalCustomerName(value.replace(/^cliente\s*:\s*/i, "").trim());
}

function normalizeProduct(value) {
  const normalized = normalize(value)
    .replace(/\balacalino\b/g, "alcalino")
    .replace(/\blegia\b/g, "lejia")
    .replace(/^cloros$/, "cloro")
    .replace(/^calcios$/, "calcio")
    .replace(/^sodas$/, "soda")
    .replace(/^feculas$/, "fecula")
    .replace(/^delantales$/, "delantal")
    .replace(/^cofias$/, "cofia")
    .replace(/^peraceticos$/, "peracetico")
    .replace(/^nitricos$/, "nitrico")
    .replace(/^detergentes$/, "detergente")
    .replace(/^esponjas$/, "esponja");
  return canonicalProductName(normalized);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
