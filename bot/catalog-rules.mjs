const CUSTOMER_ALIASES = new Map([
  ["la nueva", "La Nueva S.A."],
  ["la nueva s a", "La Nueva S.A."],
  ["megafe", "Megafe"],
  ["megafee", "Megafe"],
  ["el molino", "El Molino S.R.L."],
  ["el molino s r l", "El Molino S.R.L."],
  ["molino", "El Molino S.R.L."],
  ["molinos", "El Molino S.R.L."],
  ["molino fenix", "El Molino S.R.L."],
  ["molinos fenix", "El Molino S.R.L."],
  ["molino fenix s r l", "El Molino S.R.L."],
  ["molinos fenix s r l", "El Molino S.R.L."],
  ["nuestro pago", "Nuestros Pagos"],
  ["nuestro pagos", "Nuestros Pagos"],
  ["nuestros pago", "Nuestros Pagos"],
  ["nuestros pagos", "Nuestros Pagos"],
  ["nuestros pagoz", "Nuestros Pagos"],
  ["raggio di sole", "Raggio Di Sole"],
  ["raggio de sole", "Raggio Di Sole"],
  ["raggio de some", "Raggio Di Sole"],
  ["raggio some", "Raggio Di Sole"],
  ["raggio sole", "Raggio Di Sole"],
  ["la colonia", "La Colonia"],
  ["colonia", "La Colonia"]
]);

const PRODUCT_ALIASES = new Map([
  ["cloro", "hipoclorito de sodio"],
  ["cloros", "hipoclorito de sodio"],
  ["hipoclorito", "hipoclorito de sodio"],
  ["hipoclorito de sodio", "hipoclorito de sodio"],
  ["nitrico", "acido nitrico"],
  ["acido nitrico", "acido nitrico"],
  ["lejia", "lejia dornic"],
  ["legia", "lejia dornic"],
  ["lejia dornic", "lejia dornic"],
  ["legia dornic", "lejia dornic"],
  ["pico", "pico acidimetro"],
  ["pico acidimetro", "pico acidimetro"],
  ["acidimetro", "pico acidimetro"],
  ["pinza mohr", "pinza mohr"],
  ["fenol", "fenolftaleina"],
  ["fenolftaleina", "fenolftaleina"],
  ["fenolftalina", "fenolftaleina"],
  ["fenol taleina", "fenolftaleina"],
  ["calcio holandes", "calcio nedmag"],
  ["calcio nedmag", "calcio nedmag"],
  ["botas calfor pampeana blancas", "bota blanca calfor pampeana"],
  ["bota blanca calfor pampeana", "bota blanca calfor pampeana"]
]);

export function canonicalCustomerName(value) {
  const trimmed = value.trim();
  return CUSTOMER_ALIASES.get(key(trimmed)) || trimmed;
}

export function customerNameVariants(value) {
  const canonical = canonicalCustomerName(value);
  const variants = new Set([value, canonical, canonical.toUpperCase()]);

  for (const [alias, aliasCanonical] of CUSTOMER_ALIASES.entries()) {
    if (aliasCanonical === canonical) {
      variants.add(alias);
      variants.add(titleCase(alias));
      variants.add(alias.toUpperCase());
    }
  }

  return [...variants].map((entry) => entry.trim()).filter(Boolean);
}

export function knownCustomerName(value) {
  const normalized = key(value);
  if (!normalized) return null;

  const exact = CUSTOMER_ALIASES.get(normalized);
  if (exact) return exact;

  const matches = [...CUSTOMER_ALIASES.entries()]
    .filter(([alias]) => containsTerm(normalized, alias))
    .sort((a, b) => b[0].length - a[0].length);

  return matches[0]?.[1] ?? null;
}

export function stripKnownCustomerAlias(value) {
  let cleaned = value;

  for (const alias of [...CUSTOMER_ALIASES.keys()].sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(alias)}([^a-z0-9]|$)`, "i");
    cleaned = cleaned.replace(pattern, " ").replace(/\s+/g, " ").trim();
  }

  return cleaned;
}

export function canonicalProductName(value) {
  const normalized = key(value);
  return PRODUCT_ALIASES.get(normalized) || normalized;
}

export function productReviewReason(productNormalized) {
  if (productNormalized === "bolsa" || productNormalized === "bolsas") {
    return "Confirmar tipo o medida de bolsas";
  }
  return null;
}

function key(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsTerm(normalizedText, alias) {
  const normalizedAlias = key(alias);
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedAlias)}([^a-z0-9]|$)`, "i").test(normalizedText);
}

function titleCase(value) {
  return value
    .split(" ")
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
