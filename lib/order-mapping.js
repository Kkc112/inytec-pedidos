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

  return {
    id: order.external_id ?? order.id,
    dbId: order.id,
    source_candidate_id: order.external_id ?? order.id,
    is_order: uiStatus !== "discarded",
    order_type: uiStatus === "discarded" ? "not_order" : "new_order",
    customer: {
      name: order.customer_name,
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
      product_original: item.product_text,
      product_normalized: item.product_normalized ?? item.product_text,
      quantity: item.quantity === null ? null : Number(item.quantity),
      unit: item.unit,
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
    sellerName: order.seller_name ?? "Sin vendedor",
    customerName: order.customer_name ?? "Sin cliente",
    startedAt: order.created_at,
    originalText: order.original_text ?? "",
    attachmentFilenames: media.filenames ?? []
  };
}

export function liveOrderToDashboardOrder(order) {
  const media = order.media ?? {};
  const uiStatus = dbStatusToUi(order.status);

  return {
    id: order.external_id,
    source_candidate_id: order.external_id,
    is_order: uiStatus !== "discarded",
    order_type: order.source_summary ?? "whatsapp_live",
    customer: {
      name: order.customer_name,
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
      product_original: item.productText,
      product_normalized: item.productNormalized ?? item.productText,
      quantity: item.quantity === null ? null : Number(item.quantity),
      unit: item.unit,
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
    sellerName: order.seller_name ?? "Sin vendedor",
    customerName: order.customer_name ?? "Sin cliente",
    startedAt: order.created_at,
    originalText: order.original_text ?? "",
    attachmentFilenames: media.filenames ?? []
  };
}
