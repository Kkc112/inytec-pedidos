const CUSTOMER_ALIASES = new Map([
  ["la nueva", "La Nueva S.A."],
  ["la nueva s a", "La Nueva S.A."],
  ["megafe", "Megafe"],
  ["megafee", "Megafe"]
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
  ["calcio holandes", "calcio nedmag"],
  ["calcio nedmag", "calcio nedmag"],
  ["botas calfor pampeana blancas", "bota blanca calfor pampeana"],
  ["bota blanca calfor pampeana", "bota blanca calfor pampeana"]
]);

export function canonicalCustomerName(value) {
  const trimmed = value.trim();
  return CUSTOMER_ALIASES.get(key(trimmed)) || trimmed;
}

export function canonicalProductName(value) {
  const normalized = key(value);
  return PRODUCT_ALIASES.get(normalized) || normalized;
}

export function productReviewReason(productNormalized) {
  if (productNormalized === "calcio") return "Confirmar si el calcio es chino o Nedmag/holandes";
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
