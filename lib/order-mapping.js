import { canonicalCustomerName, canonicalProductName, knownCustomerName, stripKnownCustomerAlias } from "../bot/catalog-rules.mjs";

export const UI_TO_DB_STATUS = {
  new: "new",
  review: "needs_review",
  confirmed: "preparing",
  preparing: "preparing",
  delivered: "delivered",
  discarded: "discarded"
};

export const DB_TO_UI_STATUS = {
  new: "new",
  needs_review: "review",
  confirmed: "preparing",
  preparing: "preparing",
  delivered: "delivered",
  cancelled: "discarded",
  discarded: "discarded"
};

export function dbStatusToUi(status) {
  return DB_TO_UI_STATUS[status] ?? "review";
}

export function uiStatusToDb(status) {
  return UI_TO_DB_STATUS[status] ?? "needs_review";
}

export function extractedOrderToDashboardOrder(order, candidate = null) {
  const startedAt = candidate?.start_at ?? order.created_at ?? new Date().toISOString();
  const initialStatus = order.needs_review
    ? "review"
    : order.order_type === "price_request"
      ? "review"
      : order.is_order
        ? "new"
        : "discarded";

  return {
    ...order,
    id: order.source_candidate_id ?? order.id,
    initialStatus,
    status: initialStatus,
    sellerName: order.seller?.name ?? candidate?.seller_guess ?? "Sin vendedor",
    customerName: order.customer?.name ?? candidate?.customer_guess ?? "Sin cliente",
    startedAt,
    originalText: candidate?.original_text ?? order.original_text ?? "",
    attachmentFilenames: order.media_processing?.filenames ?? candidate?.attachments?.map((item) => item.filename) ?? []
  };
}

export function dbOrderToDashboardOrder(order) {
  const media = order.media ?? {};
  const items = order.order_items ?? [];
  const uiStatus = dbStatusToUi(order.status);
  const customerName = knownCustomerName(order.original_text ?? "") || canonicalCustomerName(order.customer_name ?? "Sin cliente");

  return {
    id: order.external_id ?? order.id,
    dbId: order.id,
    source_candidate_id: order.external_id ?? order.id,
    is_order: uiStatus !== "discarded",
    order_type: uiStatus === "discarded" ? "not_order" : "new_order",
    customer: {
      name: customerName,
      confidence: order.confidence ?? 0,
      needs_review: order.needs_review
    },
    seller: {
      name: order.seller_name ?? "Sin vendedor",
      confidence: 0.9
    },
    requested_delivery: {
      date_text: null,
      urgency: "unknown"
    },
    items: items.map((item) => ({
      id: item.id,
      ...normalizeDashboardItem(item.product_text, item.product_normalized, item.quantity, item.unit),
      notes: item.notes,
      confidence: item.confidence ?? 0,
      needs_review: false
    })),
    notes: order.notes ? [order.notes] : [],
    questions: [],
    media_processing: {
      has_audio: Boolean(media.has_audio),
      has_images: Boolean(media.has_images),
      has_pdfs: Boolean(media.has_pdfs),
      requires_transcription: Boolean(media.requires_transcription),
      requires_image_reading: Boolean(media.requires_image_reading),
      filenames: media.filenames ?? []
    },
    confidence: order.confidence ?? 0,
    needs_review: order.needs_review,
    initialStatus: uiStatus,
    status: uiStatus,
    dbIds: [order.id],
    sellerName: order.seller_name ?? "Sin vendedor",
    customerName,
    startedAt: order.created_at,
    originalText: order.original_text ?? "",
    attachmentFilenames: media.filenames ?? []
  };
}

export function liveOrderToDashboardOrder(order) {
  const media = order.media ?? {};
  const uiStatus = dbStatusToUi(order.status);
  const customerName = knownCustomerName(order.original_text ?? "") || canonicalCustomerName(order.customer_name ?? "Sin cliente");

  return {
    id: order.external_id,
    source_candidate_id: order.external_id,
    is_order: uiStatus !== "discarded",
    order_type: order.source_summary ?? "whatsapp_live",
    customer: {
      name: customerName,
      confidence: order.confidence ?? 0,
      needs_review: order.needs_review
    },
    seller: {
      name: order.seller_name ?? "Sin vendedor",
      confidence: 0.9
    },
    requested_delivery: {
      date_text: null,
      urgency: "unknown"
    },
    items: (order.items ?? []).map((item) => ({
      ...normalizeDashboardItem(item.productText, item.productNormalized, item.quantity, item.unit),
      notes: item.notes ?? null,
      confidence: item.confidence ?? 0,
      needs_review: (item.confidence ?? 0) < 0.7
    })),
    notes: order.notes ? [order.notes] : [],
    questions: [],
    media_processing: {
      has_audio: Boolean(media.has_audio),
      has_images: Boolean(media.has_images),
      has_pdfs: Boolean(media.has_pdfs),
      requires_transcription: Boolean(media.requires_transcription),
      requires_image_reading: Boolean(media.requires_image_reading),
      filenames: media.filenames ?? []
    },
    confidence: order.confidence ?? 0,
    needs_review: order.needs_review,
    initialStatus: uiStatus,
    status: uiStatus,
    dbIds: [],
    sellerName: order.seller_name ?? "Sin vendedor",
    customerName,
    startedAt: order.created_at,
    originalText: order.original_text ?? "",
    attachmentFilenames: media.filenames ?? []
  };
}

export function groupOpenDashboardOrders(orders) {
  const result = [];
  const openByCustomer = new Map();

  for (const order of orders) {
    if (order.status === "delivered" || order.status === "discarded") {
      result.push(order);
      continue;
    }

    const key = normalizeGroupKey(order.customerName);
    const existing = openByCustomer.get(key);
    if (!existing) {
      openByCustomer.set(key, order);
      result.push(order);
      continue;
    }

    existing.id = existing.id.startsWith("group_") ? existing.id : `group_${key}_${existing.id}`;
    existing.dbIds = [...new Set([...(existing.dbIds ?? [existing.dbId].filter(Boolean)), ...(order.dbIds ?? [order.dbId].filter(Boolean))])];
    existing.items = [...existing.items, ...order.items];
    existing.notes = [...existing.notes, ...order.notes].filter(Boolean);
    existing.questions = [...existing.questions, ...order.questions].filter(Boolean);
    existing.originalText = [existing.originalText, order.originalText].filter(Boolean).join("\n\n");
    existing.attachmentFilenames = [...new Set([...existing.attachmentFilenames, ...order.attachmentFilenames])];
    existing.media_processing = mergeDashboardMedia(existing.media_processing, order.media_processing);
    existing.needs_review = existing.needs_review || order.needs_review;
    existing.status = strongestOpenStatus(existing.status, order.status);
    existing.initialStatus = existing.status;
    if (new Date(order.startedAt) < new Date(existing.startedAt)) existing.startedAt = order.startedAt;
  }

  return result;
}

function normalizeDashboardItem(productText, productNormalized, quantity, unit) {
  const cleanedOriginal = stripKnownCustomerAlias(productText ?? "");
  const cleanedNormalized = stripKnownCustomerAlias(productNormalized ?? productText ?? "");
  const inferred = inferItemPresentation(cleanedOriginal);
  const finalProduct = inferred.product ?? cleanedOriginal;

  return {
    product_original: finalProduct,
    product_normalized: canonicalProductName(inferred.product ?? cleanedNormalized),
    quantity: quantity === null || quantity === undefined ? inferred.quantity : Number(quantity),
    unit: unit ?? inferred.unit
  };
}

function inferItemPresentation(value = "") {
  const normalized = value.trim();
  const ibc = normalized.replace(/^\s*una?\s+/i, "1 ").match(/^\s*(?<qty>\d+[.,]?\d*)?\s*(?<unit>ibcs?|ibc)\s+(?:de\s+)?(?<product>.+)$/i);
  if (ibc) {
    return {
      product: ibc.groups.product.trim(),
      quantity: Number((ibc.groups.qty ?? "1").replace(",", ".")),
      unit: "ibc"
    };
  }

  const trailing = normalized.match(/^(?<product>.+?)\s+(?<qty>\d+[.,]?\d*)\s*$/i);
  if (trailing && !/\d/.test(trailing.groups.product)) {
    return {
      product: trailing.groups.product.trim(),
      quantity: Number(trailing.groups.qty.replace(",", ".")),
      unit: null
    };
  }

  return { product: normalized, quantity: null, unit: null };
}

function normalizeGroupKey(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function strongestOpenStatus(current, next) {
  if (current === "review" || next === "review") return "review";
  if (current === "preparing" || next === "preparing") return "preparing";
  return "new";
}

function mergeDashboardMedia(current = {}, next = {}) {
  return {
    has_audio: Boolean(current.has_audio || next.has_audio),
    has_images: Boolean(current.has_images || next.has_images),
    has_pdfs: Boolean(current.has_pdfs || next.has_pdfs),
    requires_transcription: Boolean(current.requires_transcription || next.requires_transcription),
    requires_image_reading: Boolean(current.requires_image_reading || next.requires_image_reading),
    filenames: [...new Set([...(current.filenames ?? []), ...(next.filenames ?? [])])]
  };
}
