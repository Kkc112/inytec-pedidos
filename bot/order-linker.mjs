import { detectOrder, detectStandaloneCustomer } from "./order-heuristics.mjs";

export class OrderLinker {
  constructor({ windowMs = 3 * 60 * 1000 } = {}) {
    this.windowMs = windowMs;
    this.pendingOrders = [];
    this.pendingCustomers = [];
  }

  evaluate(block) {
    const now = new Date(block.endedAt || block.startedAt).getTime();
    this.cleanup(now);

    let detection = detectBlock(block);
    if (!detection) {
      const customer = detectStandaloneCustomer(block.text);
      if (!customer) return { action: "ignored" };

      const pendingOrder = this.findCandidate(this.pendingOrders, block);
      if (!pendingOrder) {
        this.pendingCustomers.push({ block, expiresAt: now + this.windowMs });
        return { action: "customer_waiting", customer };
      }

      this.remove(this.pendingOrders, pendingOrder);
      const combinedBlock = mergeBlocks(pendingOrder.block, block);
      detection = detectBlock(combinedBlock);
      if (!detection) return { action: "ignored" };

      return {
        action: "updated",
        block: combinedBlock,
        detection: noteDifferentAuthor(detection, pendingOrder.block, block)
      };
    }

    const pendingOrder = !detection.customerGuess
      ? this.findCandidate(this.pendingOrders, block, { allowOtherAuthor: false })
      : null;
    if (pendingOrder) {
      this.remove(this.pendingOrders, pendingOrder);
      const combinedBlock = mergeBlocks(pendingOrder.block, block);
      const combinedDetection = detectBlock(combinedBlock);
      if (combinedDetection) {
        detection = noteDifferentAuthor(combinedDetection, pendingOrder.block, block);
        block = combinedBlock;
        if (!detection.customerGuess) this.rememberOrder(block, detection, now);
        return { action: "updated", block, detection };
      }
    }

    if (!detection.customerGuess) {
      const pendingCustomer = this.findCandidate(this.pendingCustomers, block);
      if (pendingCustomer) {
        this.remove(this.pendingCustomers, pendingCustomer);
        const combinedBlock = mergeBlocks(block, pendingCustomer.block);
        const combinedDetection = detectBlock(combinedBlock);
        if (combinedDetection?.customerGuess) {
          return {
            action: "created",
            block: combinedBlock,
            detection: noteDifferentAuthor(combinedDetection, block, pendingCustomer.block)
          };
        }
      }
      this.rememberOrder(block, detection, now);
    }

    return { action: "created", block, detection };
  }

  rememberOrder(block, detection, now) {
    this.pendingOrders.push({ block, detection, expiresAt: now + this.windowMs });
  }

  cleanup(now) {
    this.pendingOrders = this.pendingOrders.filter((entry) => entry.expiresAt >= now);
    this.pendingCustomers = this.pendingCustomers.filter((entry) => entry.expiresAt >= now);
  }

  findCandidate(entries, block, { allowOtherAuthor = true } = {}) {
    const sameChat = entries.filter((entry) => entry.block.chatId === block.chatId);
    const sameAuthor = sameChat.filter((entry) => entry.block.authorId === block.authorId);
    if (sameAuthor.length) return sameAuthor[sameAuthor.length - 1];
    if (allowOtherAuthor && sameChat.length === 1) return sameChat[0];
    return null;
  }

  remove(entries, target) {
    const index = entries.indexOf(target);
    if (index >= 0) entries.splice(index, 1);
  }
}

function mergeBlocks(primary, extra) {
  return {
    ...primary,
    endedAt: extra.endedAt,
    messages: [...primary.messages, ...extra.messages],
    text: [primary.text, extra.text].filter(Boolean).join("\n")
  };
}

function noteDifferentAuthor(detection, primary, extra) {
  if (primary.authorId === extra.authorId) return detection;
  return {
    ...detection,
    needsReview: true,
    notes: [...detection.notes, `Cliente o complemento informado por ${extra.authorName}`]
  };
}

function detectBlock(block) {
  return detectOrder(block) || detectMediaAttachment(block);
}

function detectMediaAttachment(block) {
  const kinds = new Set(block.messages.flatMap((message) => message.attachments.map((attachment) => attachment.kind)));
  const supported = [...kinds].filter((kind) => ["audio", "image", "pdf"].includes(kind));
  if (!supported.length) return null;

  const customerGuess = detectStandaloneCustomer(block.text);
  const labels = supported.map((kind) => ({ audio: "Audio", image: "Imagen", pdf: "PDF" })[kind]);

  return {
    customerGuess,
    items: [],
    notes: [`${labels.join(" y ")} pendiente de lectura manual`],
    needsReview: true,
    confidence: customerGuess ? 0.55 : 0.35
  };
}
