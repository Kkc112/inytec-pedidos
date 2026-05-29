"use client";

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  Headphones,
  Image as ImageIcon,
  LayoutList,
  MessageSquareText,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Trash2,
  Truck,
  UserRound,
  Warehouse,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "../lib/supabase";

const STATUS = {
  all: { label: "Todos", tone: "neutral" },
  new: { label: "Nuevo", tone: "blue" },
  review: { label: "En revision", tone: "amber" },
  preparing: { label: "Listo", tone: "violet" },
  delivered: { label: "Entregado", tone: "green" }
};

const FILTERS = {
  ...STATUS,
  needsReview: { label: "Requiere revision", tone: "red" }
};

const STATUS_ICON = {
  new: ClipboardList,
  review: AlertTriangle,
  preparing: PackageCheck,
  delivered: Truck
};

const NEXT_STATUS = {
  new: "preparing",
  review: "preparing",
  preparing: "delivered",
  delivered: "delivered",
  discarded: "discarded"
};

const CALCIUM_VARIANTS = [
  { label: "Chino", value: "calcio chino" },
  { label: "Nedmag / Holandes", value: "calcio nedmag" }
];

const PRODUCT_VARIANTS = {
  calcio: CALCIUM_VARIANTS,
  "calcio chino": CALCIUM_VARIANTS,
  "calcio nedmag": CALCIUM_VARIANTS
};

const TRANSPORTERS = ["Miguel", "Dani", "Mariano", "Ratti"];
const DATE_FILTERS = { all: "Todas", today: "Hoy", week: "7 dias", custom: "Fecha" };

function visibleStatus(status) {
  return status === "confirmed" ? "preparing" : status;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatFullDate(value) {
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function dateInputValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function isSameDate(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function statusLabel(status) {
  return STATUS[visibleStatus(status)]?.label ?? "Pedido";
}

function orderRequiresReview(order) {
  const media = order.media_processing ?? {};
  return Boolean(
    order.needs_review ||
      media.has_audio ||
      media.has_images ||
      media.requires_transcription ||
      media.requires_image_reading ||
      (order.confidence ?? 1) < 0.7 ||
      order.items.some((item) => !item.quantity || !item.product_normalized)
  );
}

function hydrateOrders(initialOrders) {
  const stored = readStoredState();
  return initialOrders.map((order) => ({
    ...order,
    status: visibleStatus(stored[order.id]?.status ?? order.initialStatus),
    editedAt: stored[order.id]?.editedAt ?? null
  }));
}

function readStoredState() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem("inytec-order-state") ?? "{}");
  } catch {
    return {};
  }
}

function saveStoredState(orders) {
  const state = Object.fromEntries(
    orders.map((order) => [order.id, { status: order.status, editedAt: order.editedAt }])
  );
  window.localStorage.setItem("inytec-order-state", JSON.stringify(state));
}

export default function MobileDashboard({ initialOrders, source }) {
  const [orders, setOrders] = useState(() =>
    initialOrders.map((order) => ({ ...order, status: visibleStatus(order.initialStatus) }))
  );
  const [activeStatus, setActiveStatus] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [customDate, setCustomDate] = useState("");
  const [viewMode, setViewMode] = useState("orders");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [lastSync, setLastSync] = useState(new Date());
  const [updatingItemId, setUpdatingItemId] = useState(null);
  const [deletingOrderId, setDeletingOrderId] = useState(null);
  const [savingCorrectionId, setSavingCorrectionId] = useState(null);
  const [botStatus, setBotStatus] = useState({ checking: source === "supabase", connected: false });

  useEffect(() => {
    setOrders(source === "local" ? hydrateOrders(initialOrders) : initialOrders);
  }, [initialOrders, source]);

  useEffect(() => {
    if (source === "local" && orders.length) saveStoredState(orders);
  }, [orders, source]);

  useEffect(() => {
    const timer = window.setInterval(() => setLastSync(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const reloadOrders = useCallback(async () => {
    try {
      const response = await fetch("/api/orders", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      setOrders(payload.source === "local" ? hydrateOrders(payload.orders) : payload.orders);
      setLastSync(new Date());
    } catch {
      // Keep current data visible when connection is temporary unavailable.
    }
  }, []);

  const reloadBotStatus = useCallback(async () => {
    if (source !== "supabase") return;
    try {
      const response = await fetch("/api/bot-status", { cache: "no-store" });
      const payload = await response.json();
      setBotStatus({ checking: false, connected: Boolean(payload.connected), group: payload.group });
    } catch {
      setBotStatus({ checking: false, connected: false });
    }
  }, [source]);

  useEffect(() => {
    if (source !== "supabase") return undefined;
    reloadBotStatus();
    const timer = window.setInterval(reloadBotStatus, 20000);
    return () => window.clearInterval(timer);
  }, [reloadBotStatus, source]);

  useEffect(() => {
    if (source !== "supabase") return undefined;
    const supabase = createBrowserSupabaseClient();
    if (!supabase) return undefined;
    const channel = supabase
      .channel("orders-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, reloadOrders)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, reloadOrders)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_events" }, reloadOrders)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [reloadOrders, source]);

  useEffect(() => {
    const timer = window.setInterval(reloadOrders, source === "supabase" ? 4000 : 5000);
    return () => window.clearInterval(timer);
  }, [reloadOrders, source]);

  const counts = useMemo(() => {
    const base = Object.keys(FILTERS).reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
    for (const order of orders.filter((entry) => entry.status !== "discarded")) {
      base.all += 1;
      base[order.status] = (base[order.status] ?? 0) + 1;
      if (orderRequiresReview(order)) base.needsReview += 1;
    }
    return base;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const now = new Date();
    return orders.filter((order) => {
      if (order.status === "discarded") return false;
      if (viewMode === "dispatch" && !["preparing", "delivered"].includes(order.status)) return false;
      const reviewMatch = activeStatus === "needsReview" && orderRequiresReview(order);
      const statusMatch = activeStatus === "all" || order.status === activeStatus || reviewMatch;
      const createdAt = new Date(order.startedAt);
      const dateMatch =
        dateFilter === "all" ||
        (dateFilter === "today" && isSameDate(createdAt, now)) ||
        (dateFilter === "week" && now.getTime() - createdAt.getTime() <= 7 * 24 * 60 * 60 * 1000) ||
        (dateFilter === "custom" && customDate && dateInputValue(order.startedAt) === customDate);
      const text = `${order.customerName} ${order.sellerName} ${order.carrierName ?? ""} ${statusLabel(order.status)} ${
        order.originalText ?? ""
      } ${order.items.map((item) => `${item.product_normalized} ${item.product_original}`).join(" ")}`.toLowerCase();
      return statusMatch && dateMatch && (!normalizedQuery || text.includes(normalizedQuery));
    });
  }, [activeStatus, customDate, dateFilter, orders, query, viewMode]);

  const selectedOrder = orders.find((order) => order.id === selectedId) ?? filteredOrders[0] ?? null;

  async function setStatus(orderId, status) {
    const previousOrders = orders;
    const targetOrder = orders.find((order) => order.id === orderId);
    const apiOrderId = targetOrder?.dbIds?.length ? targetOrder.dbIds.join(",") : targetOrder?.dbId ?? orderId;
    setOrders((current) =>
      current.map((order) => (order.id === orderId ? { ...order, status, editedAt: new Date().toISOString() } : order))
    );
    setSelectedId(orderId);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(apiOrderId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (!response.ok) throw new Error("No se pudo guardar");
      await reloadOrders();
    } catch {
      setOrders(previousOrders);
      await reloadOrders();
      window.alert("No se pudo guardar el cambio. Toca sincronizar y proba nuevamente.");
    }
  }

  function advanceOrder(orderId) {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return;
    setStatus(orderId, NEXT_STATUS[order.status]);
  }

  async function setItemVariant(order, item, productNormalized) {
    if (!item.id || !PRODUCT_VARIANTS[item.product_normalized]?.some((variant) => variant.value === productNormalized)) return;
    setUpdatingItemId(item.id);
    setOrders((current) =>
      current.map((candidate) =>
        candidate.id !== order.id
          ? candidate
          : {
              ...candidate,
              items: candidate.items.map((lineItem) =>
                lineItem.id === item.id ? { ...lineItem, product_normalized: productNormalized } : lineItem
              )
            }
      )
    );
    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(order.dbId ?? order.id)}/items/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productNormalized })
        }
      );
      if (!response.ok) await reloadOrders();
    } catch {
      await reloadOrders();
    } finally {
      setUpdatingItemId(null);
    }
  }

  async function deleteOrder(order) {
    if (!window.confirm(`Eliminar el pedido de ${order.customerName}? Esta accion no se puede deshacer.`)) return;
    setDeletingOrderId(order.id);
    try {
      const apiOrderId = order.dbIds?.length ? order.dbIds.join(",") : order.dbId ?? order.id;
      const response = await fetch(`/api/orders/${encodeURIComponent(apiOrderId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "discarded" })
      });
      if (!response.ok) {
        window.alert("No se pudo eliminar el pedido. Intenta nuevamente.");
        return;
      }
      setOrders((current) => current.filter((candidate) => candidate.id !== order.id));
      setSelectedId(null);
      setLastSync(new Date());
    } catch {
      window.alert("No se pudo eliminar el pedido. Intenta nuevamente.");
    } finally {
      setDeletingOrderId(null);
    }
  }

  async function saveCorrection(order, correction) {
    const previousOrders = orders;
    const apiOrderId = order.dbIds?.length ? order.dbIds.join(",") : order.dbId ?? order.id;
    const nextCustomerName = correction.customerName.trim() || order.customerName;
    const nextItems = correction.items
      .map((item) => ({
        ...item,
        product_original: item.productText.trim(),
        product_normalized: item.productNormalized.trim() || item.productText.trim(),
        quantity: item.quantity === "" || item.quantity === null ? null : Number(String(item.quantity).replace(",", ".")),
        unit: item.unit.trim() || null,
        notes: item.notes?.trim() || null
      }))
      .filter((item) => item.product_original);
    setSavingCorrectionId(order.id);
    setOrders((current) =>
      current.map((candidate) =>
        candidate.id === order.id
          ? {
              ...candidate,
              customerName: nextCustomerName,
              customer: { ...candidate.customer, name: nextCustomerName, needs_review: false },
              items: nextItems,
              needs_review: false
            }
          : candidate
      )
    );
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(apiOrderId)}/correction`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: nextCustomerName,
          items: nextItems.map((item) => ({
            id: item.id?.startsWith("new_") ? null : item.id,
            productText: item.product_original,
            productNormalized: item.product_normalized,
            quantity: item.quantity,
            unit: item.unit,
            notes: item.notes
          }))
        })
      });
      if (!response.ok) throw new Error("No se pudo guardar");
      await reloadOrders();
    } catch {
      setOrders(previousOrders);
      await reloadOrders();
      window.alert("No se pudo guardar la correccion. Toca sincronizar y proba nuevamente.");
    } finally {
      setSavingCorrectionId(null);
    }
  }

  async function setCarrier(orderId, carrierName) {
    const previousOrders = orders;
    const targetOrder = orders.find((order) => order.id === orderId);
    const apiOrderId = targetOrder?.dbIds?.length ? targetOrder.dbIds.join(",") : targetOrder?.dbId ?? orderId;
    const nextCarrierName = targetOrder?.carrierName === carrierName ? null : carrierName;
    setOrders((current) =>
      current.map((order) => (order.id === orderId ? { ...order, carrierName: nextCarrierName } : order))
    );
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(apiOrderId)}/carrier`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carrierName: nextCarrierName })
      });
      if (!response.ok) throw new Error("No se pudo guardar");
      await reloadOrders();
    } catch {
      setOrders(previousOrders);
      await reloadOrders();
      window.alert("No se pudo guardar el transportista. Toca sincronizar y proba nuevamente.");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-header">
          <img className="brand-logo" src="/brand/inytec-logo.jpg" alt="Inytec Insumos y Servicios" />
          <div>
            <p className="eyebrow">Gestion operativa</p>
            <h1>{viewMode === "dispatch" ? "Deposito y reparto" : "Pedidos"}</h1>
          </div>
        </div>
        <div className={`live-pill ${source === "supabase" && botStatus.checking ? "checking" : ""} ${
          source === "supabase" && !botStatus.checking && !botStatus.connected ? "offline" : ""
        }`}>
          <span />
          {source === "supabase"
            ? botStatus.checking
              ? "Verificando"
              : botStatus.connected
                ? "Bot conectado"
                : "Bot sin conexion"
            : source === "live"
              ? "Local"
              : "Demo"}
        </div>
      </header>

      <section className="view-switch" aria-label="Vista">
        <button className={viewMode === "orders" ? "active" : ""} onClick={() => setViewMode("orders")} type="button">
          <LayoutList size={17} />
          Gestion
        </button>
        <button
          className={viewMode === "dispatch" ? "active" : ""}
          onClick={() => setViewMode("dispatch")}
          type="button"
        >
          <Warehouse size={17} />
          Deposito/Reparto
        </button>
      </section>

      <section className="metrics" aria-label="Resumen">
        <Metric icon={AlertTriangle} label="Revision" onClick={() => setActiveStatus("needsReview")} value={counts.review + counts.needsReview} tone="amber" />
        <Metric icon={ClipboardList} label="Nuevos" onClick={() => setActiveStatus("new")} value={counts.new} tone="blue" />
        <Metric icon={PackageCheck} label="Listos" onClick={() => setActiveStatus("preparing")} value={counts.preparing} tone="violet" />
        <Metric icon={Truck} label="Entregados" onClick={() => setActiveStatus("delivered")} value={counts.delivered} tone="green" />
      </section>

      <section className="toolbar" aria-label="Filtros">
        <label className="search-box">
          <Search size={17} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cliente, producto, texto original, estado o transportista..."
          />
        </label>
        <label className="date-filter">
          <CalendarDays size={17} />
          <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
            {Object.entries(DATE_FILTERS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          {dateFilter === "custom" && (
            <input aria-label="Fecha exacta" value={customDate} onChange={(event) => setCustomDate(event.target.value)} type="date" />
          )}
        </label>
        <button className="icon-button" onClick={reloadOrders} type="button" title="Sincronizar" aria-label="Sincronizar">
          <RefreshCcw size={18} />
        </button>
      </section>

      <nav className="status-tabs" aria-label="Estados">
        {Object.entries(FILTERS).map(([key, status]) => (
          <button
            className={`status-tab ${activeStatus === key ? "active" : ""}`}
            data-tone={status.tone}
            key={key}
            onClick={() => setActiveStatus(key)}
            type="button"
          >
            <span>{status.label}</span>
            <strong>{counts[key] ?? 0}</strong>
          </button>
        ))}
      </nav>

      <section className="content-grid">
        <div className="order-list" aria-label="Lista de pedidos">
          {filteredOrders.map((order) => (
            <OrderCard
              active={selectedOrder?.id === order.id}
              key={order.id}
              onAdvance={() => advanceOrder(order.id)}
              onOpen={() => setSelectedId(order.id)}
              onSetStatus={(status) => setStatus(order.id, status)}
              order={order}
            />
          ))}
          {!filteredOrders.length && (
            <div className="empty-state">
              <ClipboardList size={32} />
              <p>Sin pedidos en esta vista.</p>
            </div>
          )}
        </div>

        <aside className={`detail-panel ${selectedId ? "open" : ""}`} aria-label="Detalle del pedido">
          {selectedOrder && (
            <OrderDetail
              deleting={deletingOrderId === selectedOrder.id}
              onClose={() => setSelectedId(null)}
              onDelete={() => deleteOrder(selectedOrder)}
              onSaveCorrection={(correction) => saveCorrection(selectedOrder, correction)}
              onSetCarrier={(carrierName) => setCarrier(selectedOrder.id, carrierName)}
              onSetItemVariant={(item, value) => setItemVariant(selectedOrder, item, value)}
              onSetStatus={(status) => setStatus(selectedOrder.id, status)}
              order={selectedOrder}
              savingCorrection={savingCorrectionId === selectedOrder.id}
              updatingItemId={updatingItemId}
            />
          )}
        </aside>
      </section>

      <footer className="mobile-footer">
        <span>Actualizado {lastSync.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span>
        <span>{filteredOrders.length} visibles</span>
      </footer>
    </main>
  );
}

function Metric({ icon: Icon, label, onClick, value, tone }) {
  return (
    <button className="metric" data-tone={tone} onClick={onClick} type="button">
      <span>{Icon && <Icon size={16} />}{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

function OrderCard({ active, onAdvance, onOpen, onSetStatus, order }) {
  const Icon = STATUS_ICON[order.status] ?? ClipboardList;
  const media = order.media_processing ?? {};
  const visibleItems = order.items.slice(0, 5);
  const requiresReview = orderRequiresReview(order);

  return (
    <article className={`order-card ${active ? "active" : ""}`}>
      <button className="order-main" onClick={onOpen} type="button">
        <div className="order-heading">
          <div className="order-badges">
            <div className="status-badge" data-status={order.status}>
              <Icon size={15} />
              {STATUS[order.status]?.label ?? "Pedido"}
            </div>
            {requiresReview && (
              <div className="status-badge review-required" data-status="review">
                <AlertTriangle size={15} />
                Requiere revision
              </div>
            )}
          </div>
          <time>{formatFullDate(order.startedAt)}</time>
        </div>
        <h2>{order.customerName}</h2>
        <div className="card-meta">
          <p className="seller"><UserRound size={14} />{order.sellerName}</p>
          <p className="seller"><Truck size={14} />{order.carrierName ?? "Sin transportista"}</p>
        </div>
        <ul className="item-preview">
          {visibleItems.map((item, index) => (
            <li key={`${order.id}_${index}`}>
              <strong>{item.quantity ?? "?"}</strong>
              <span>{item.unit ?? ""}</span>
              <p>{item.product_normalized ?? item.product_original}</p>
            </li>
          ))}
        </ul>
        {order.notes.length > 0 && <p className="card-note">{order.notes.join(" | ")}</p>}
        {order.originalText && <p className="original-preview">{order.originalText}</p>}
        <div className="order-flags">
          {media.has_audio && <Flag icon={Headphones} label="Audio" />}
          {media.has_images && <Flag icon={ImageIcon} label="Imagen" />}
          {order.carrierName && <Flag icon={Truck} label={order.carrierName} />}
        </div>
      </button>
      <div className="card-actions" aria-label="Acciones del pedido">
        <button onClick={() => onSetStatus("new")} type="button">Nuevo</button>
        <button onClick={() => onSetStatus("review")} type="button">Revision</button>
        <button onClick={() => onSetStatus("preparing")} type="button">Listo</button>
        <button onClick={() => onSetStatus("delivered")} type="button">Entregado</button>
        <button className="advance-button" onClick={onAdvance} type="button" aria-label="Avanzar estado">
          <ChevronRight size={18} />
        </button>
      </div>
    </article>
  );
}

function Flag({ icon: Icon, label }) {
  return (
    <span className="flag">
      <Icon size={13} />
      {label}
    </span>
  );
}

function OrderDetail({
  deleting,
  onClose,
  onDelete,
  onSaveCorrection,
  onSetCarrier,
  onSetItemVariant,
  onSetStatus,
  order,
  savingCorrection,
  updatingItemId
}) {
  const media = order.media_processing ?? {};
  const [editing, setEditing] = useState(false);
  const [customerName, setCustomerName] = useState(order.customerName);
  const [draftItems, setDraftItems] = useState(() => buildDraftItems(order.items));

  useEffect(() => {
    setEditing(false);
    setCustomerName(order.customerName);
    setDraftItems(buildDraftItems(order.items));
  }, [order.id]);

  useEffect(() => {
    if (editing || savingCorrection) return;
    setCustomerName(order.customerName);
    setDraftItems(buildDraftItems(order.items));
  }, [editing, order.customerName, order.items, savingCorrection]);

  function updateDraftItem(index, patch) {
    setDraftItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function addDraftItem() {
    setDraftItems((current) => [
      ...current,
      { id: `new_${Date.now()}`, productText: "", productNormalized: "", quantity: "", unit: "", notes: "" }
    ]);
  }

  function removeDraftItem(index) {
    setDraftItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function submitCorrection() {
    await onSaveCorrection({ customerName, items: draftItems });
    setEditing(false);
  }

  return (
    <div className="detail-inner">
      <div className="detail-header">
        <button className="icon-button desktop-hidden" onClick={onClose} type="button" aria-label="Volver">
          <ChevronLeft size={19} />
        </button>
        <div>
          <p className="eyebrow">Detalle</p>
          <h2>{order.customerName}</h2>
        </div>
        <div className="detail-header-actions">
          <button className="icon-button" disabled={savingCorrection} onClick={() => setEditing((value) => !value)} type="button" title="Corregir pedido" aria-label="Corregir pedido">
            <Pencil size={18} />
          </button>
          <button className="icon-button delete-button" disabled={deleting} onClick={onDelete} type="button" title="Eliminar pedido" aria-label="Eliminar pedido">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="detail-meta">
        <span><UserRound size={13} /> {order.sellerName}</span>
        <span><Truck size={13} /> {order.carrierName ?? "Sin transportista"}</span>
        <span><Clock3 size={13} /> {formatFullDate(order.startedAt)}</span>
        <span><CheckCircle2 size={13} /> {Math.round((order.confidence ?? 0) * 100)}%</span>
      </div>

      {orderRequiresReview(order) && (
        <div className="review-callout">
          <AlertTriangle size={18} />
          <div>
            <strong>Requiere revision</strong>
            <p>Puede venir de audio, imagen o texto con datos incompletos.</p>
          </div>
        </div>
      )}

      {editing && (
        <section className="correction-panel" aria-label="Corregir pedido">
          <label className="correction-field">
            <span>Cliente</span>
            <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
          </label>
          <div className="correction-items">
            {draftItems.map((item, index) => (
              <div className="correction-item" key={item.id ?? index}>
                <label><span>Cant.</span><input inputMode="decimal" value={item.quantity} onChange={(event) => updateDraftItem(index, { quantity: event.target.value })} /></label>
                <label className="wide"><span>Producto</span><input value={item.productText} onChange={(event) => updateDraftItem(index, { productText: event.target.value, productNormalized: event.target.value })} /></label>
                <label><span>Unidad</span><input value={item.unit} onChange={(event) => updateDraftItem(index, { unit: event.target.value })} /></label>
                <button className="icon-button compact danger" onClick={() => removeDraftItem(index)} type="button" aria-label="Quitar producto">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <div className="correction-actions">
            <button className="secondary-action" onClick={addDraftItem} type="button"><Plus size={16} />Agregar producto</button>
            <button className="primary-action" disabled={savingCorrection} onClick={submitCorrection} type="button"><Save size={16} />{savingCorrection ? "Guardando" : "Guardar"}</button>
          </div>
        </section>
      )}

      <div className="status-actions">
        {["new", "review", "preparing", "delivered"].map((status) => (
          <button className={order.status === status ? "selected" : ""} data-status={status} key={status} onClick={() => onSetStatus(status)} type="button">
            {STATUS[status].label}
          </button>
        ))}
      </div>

      <section className="detail-section transporter-section">
        <h3>Transportista</h3>
        <div className="transporter-actions">
          {TRANSPORTERS.map((carrierName) => (
            <button className={order.carrierName === carrierName ? "selected" : ""} key={carrierName} onClick={() => onSetCarrier(carrierName)} type="button">
              <Truck size={15} />
              {carrierName}
            </button>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <h3>Productos</h3>
        <div className="line-items">
          {order.items.map((item, index) => (
            <div className="line-item" key={`${order.id}_detail_${index}`}>
              <div className="line-item-content">
                <strong>{item.product_normalized ?? item.product_original}</strong>
                {item.notes && <p>{item.notes}</p>}
                {PRODUCT_VARIANTS[item.product_normalized] && item.id && (
                  <div className="variant-actions" aria-label="Variante de calcio">
                    {PRODUCT_VARIANTS[item.product_normalized].map((variant) => (
                      <button className={item.product_normalized === variant.value ? "selected" : ""} disabled={updatingItemId === item.id} key={variant.value} onClick={() => onSetItemVariant(item, variant.value)} type="button">
                        {variant.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span>{item.quantity ?? "?"} {item.unit ?? ""}</span>
            </div>
          ))}
        </div>
      </section>

      {(order.notes.length > 0 || order.questions.length > 0) && (
        <section className="detail-section">
          <h3>Observaciones</h3>
          {[...order.notes, ...order.questions].map((note, index) => (
            <p className="note" key={`${order.id}_note_${index}`}>{note}</p>
          ))}
        </section>
      )}

      {(media.has_audio || media.has_images || media.has_pdfs) && (
        <section className="detail-section">
          <h3>Adjuntos</h3>
          <div className="attachments">
            {order.attachmentFilenames.map((filename) => <AttachmentPreview filename={filename} key={filename} />)}
          </div>
        </section>
      )}

      {order.originalText && (
        <section className="detail-section">
          <h3>Texto original</h3>
          <pre>{order.originalText}</pre>
        </section>
      )}

      {order.changeHistory?.length > 0 && (
        <section className="detail-section">
          <h3>Historial</h3>
          <div className="history-list">
            {order.changeHistory.map((event) => (
              <div className="history-item" key={event.id}>
                <MessageSquareText size={14} />
                <div>
                  <strong>{event.label}</strong>
                  <span>{formatFullDate(event.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function buildDraftItems(items) {
  const sourceItems = items.length
    ? items
    : [{ id: `new_${Date.now()}`, product_original: "", product_normalized: "", quantity: "", unit: "", notes: "" }];
  return sourceItems.map((item, index) => ({
    id: item.id ?? `new_${index}_${Date.now()}`,
    productText: item.product_original ?? item.product_normalized ?? "",
    productNormalized: item.product_normalized ?? item.product_original ?? "",
    quantity: item.quantity ?? "",
    unit: item.unit ?? "",
    notes: item.notes ?? ""
  }));
}

function AttachmentPreview({ filename }) {
  const source = `/api/media/${encodeURIComponent(filename)}`;
  const extension = filename.split(".").pop()?.toLowerCase();
  const isImage = ["jpg", "jpeg", "png", "webp"].includes(extension);
  const isAudio = ["opus", "ogg", "mp3", "m4a", "wav"].includes(extension);
  return (
    <div className="attachment-preview">
      {isImage && <img alt="Imagen adjunta del pedido" loading="lazy" src={source} />}
      {isAudio && <audio controls preload="metadata" src={source} />}
      {!isImage && !isAudio && <a href={source} rel="noreferrer" target="_blank">Abrir archivo</a>}
      <p>{filename}</p>
    </div>
  );
}
