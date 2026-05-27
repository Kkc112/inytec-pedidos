"use client";

import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Headphones,
  Image as ImageIcon,
  PackageCheck,
  RefreshCcw,
  Search,
  Truck,
  UserRound,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "../lib/supabase";

const STATUS = {
  all: { label: "Todos", tone: "neutral" },
  new: { label: "Nuevo", tone: "blue" },
  review: { label: "En revisión", tone: "amber" },
  preparing: { label: "Listos", tone: "violet" },
  delivered: { label: "Entregado", tone: "green" }
};

const NEXT_STATUS = {
  new: "preparing",
  review: "preparing",
  confirmed: "delivered",
  preparing: "delivered",
  delivered: "delivered",
  discarded: "discarded"
};

const STATUS_ICON = {
  new: ClipboardList,
  review: AlertTriangle,
  preparing: PackageCheck,
  delivered: Truck
};

const CALCIUM_VARIANTS = [
  { label: "Chino", value: "calcio chino" },
  { label: "Nedmag / Holandés", value: "calcio nedmag" }
];
const PRODUCT_VARIANTS = {
  calcio: CALCIUM_VARIANTS,
  "calcio chino": CALCIUM_VARIANTS,
  "calcio nedmag": CALCIUM_VARIANTS
};

function formatTime(value) {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function visibleStatus(status) {
  return status === "confirmed" ? "preparing" : status;
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
    orders.map((order) => [
      order.id,
      {
        status: order.status,
        editedAt: order.editedAt
      }
    ])
  );

  window.localStorage.setItem("inytec-order-state", JSON.stringify(state));
}

export default function MobileDashboard({ initialOrders, source }) {
  const [orders, setOrders] = useState(() =>
    initialOrders.map((order) => ({ ...order, status: visibleStatus(order.initialStatus) }))
  );
  const [activeStatus, setActiveStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [lastSync, setLastSync] = useState(new Date());
  const [updatingItemId, setUpdatingItemId] = useState(null);
  const [deletingOrderId, setDeletingOrderId] = useState(null);
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
    const response = await fetch("/api/orders", { cache: "no-store" });
    const payload = await response.json();
    setOrders(payload.source === "local" ? hydrateOrders(payload.orders) : payload.orders);
    setLastSync(new Date());
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [reloadOrders, source]);

  useEffect(() => {
    if (source === "supabase") return undefined;

    const timer = window.setInterval(reloadOrders, 5000);
    return () => window.clearInterval(timer);
  }, [reloadOrders, source]);

  const counts = useMemo(() => {
    const base = Object.keys(STATUS).reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
    for (const order of orders.filter((entry) => entry.status !== "discarded")) {
      base.all += 1;
      base[order.status] = (base[order.status] ?? 0) + 1;
    }
    return base;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return orders.filter((order) => {
      if (order.status === "discarded") return false;
      const statusMatch = activeStatus === "all" || order.status === activeStatus;
      const text = `${order.customerName} ${order.sellerName} ${order.items
        .map((item) => `${item.product_normalized} ${item.product_original}`)
        .join(" ")}`.toLowerCase();
      return statusMatch && (!normalizedQuery || text.includes(normalizedQuery));
    });
  }, [activeStatus, orders, query]);

  const selectedOrder = orders.find((order) => order.id === selectedId) ?? filteredOrders[0] ?? null;

  function setStatus(orderId, status) {
    setOrders((current) =>
      current.map((order) =>
        order.id === orderId ? { ...order, status, editedAt: new Date().toISOString() } : order
      )
    );
    setActiveStatus(status);
    setSelectedId(orderId);

    fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    }).catch(() => {
      // The optimistic UI remains useful in local/demo mode.
    });
  }

  function advanceOrder(orderId) {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return;
    setStatus(orderId, NEXT_STATUS[order.status]);
  }

  async function setItemVariant(order, item, productNormalized) {
    if (!item.id || !PRODUCT_VARIANTS[item.product_normalized]?.some((variant) => variant.value === productNormalized)) {
      return;
    }

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
    if (!window.confirm(`Eliminar el pedido de ${order.customerName}? Esta acción no se puede deshacer.`)) return;

    setDeletingOrderId(order.id);

    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.dbId ?? order.id)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "discarded" })
      });

      if (!response.ok) {
        window.alert("No se pudo eliminar el pedido. Intentá nuevamente.");
        return;
      }

      setOrders((current) => current.filter((candidate) => candidate.id !== order.id));
      setSelectedId(null);
      setLastSync(new Date());
    } catch {
      window.alert("No se pudo eliminar el pedido. Intentá nuevamente.");
    } finally {
      setDeletingOrderId(null);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-header">
          <img className="brand-logo" src="/brand/inytec-logo.jpg" alt="Inytec Insumos y Servicios" />
          <h1>Pedidos</h1>
        </div>
        <div
          className={`live-pill ${source === "supabase" && botStatus.checking ? "checking" : ""} ${
            source === "supabase" && !botStatus.checking && !botStatus.connected ? "offline" : ""
          }`}
        >
          <span />
          {source === "supabase"
            ? botStatus.checking
              ? "Verificando"
              : botStatus.connected
                ? "Bot conectado"
                : "Bot sin conexión"
            : source === "live"
              ? "Local"
              : "Demo"}
        </div>
      </header>

      <section className="metrics" aria-label="Resumen">
        <Metric label="En revisión" onClick={() => setActiveStatus("review")} value={counts.review} tone="amber" />
        <Metric label="Nuevo" onClick={() => setActiveStatus("new")} value={counts.new} tone="blue" />
        <Metric label="Listos" onClick={() => setActiveStatus("preparing")} value={counts.preparing} tone="violet" />
      </section>

      <section className="toolbar" aria-label="Filtros">
        <label className="search-box">
          <Search size={17} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cliente, producto..." />
        </label>
        <button className="icon-button" onClick={reloadOrders} type="button" title="Sincronizar" aria-label="Sincronizar">
          <RefreshCcw size={18} />
        </button>
      </section>

      <nav className="status-tabs" aria-label="Estados">
        {Object.entries(STATUS).map(([key, status]) => {
          const active = activeStatus === key;
          return (
            <button
              className={`status-tab ${active ? "active" : ""}`}
              data-tone={status.tone}
              key={key}
              onClick={() => setActiveStatus(key)}
              type="button"
            >
              <span>{status.label}</span>
              <strong>{counts[key] ?? 0}</strong>
            </button>
          );
        })}
      </nav>

      <section className="content-grid">
        <div className="order-list" aria-label="Lista de pedidos">
          {filteredOrders.map((order) => (
            <OrderCard
              active={selectedOrder?.id === order.id}
              key={order.id}
              onAdvance={() => advanceOrder(order.id)}
              onOpen={() => setSelectedId(order.id)}
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
              onDelete={() => deleteOrder(selectedOrder)}
              onClose={() => setSelectedId(null)}
              onSetItemVariant={(item, value) => setItemVariant(selectedOrder, item, value)}
              onSetStatus={(status) => setStatus(selectedOrder.id, status)}
              order={selectedOrder}
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

function Metric({ label, onClick, value, tone }) {
  return (
    <button className="metric" data-tone={tone} onClick={onClick} type="button">
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

function OrderCard({ active, onAdvance, onOpen, order }) {
  const Icon = STATUS_ICON[order.status] ?? ClipboardList;
  const media = order.media_processing ?? {};
  const visibleItems = order.items.slice(0, 3);

  return (
    <article className={`order-card ${active ? "active" : ""}`}>
      <button className="order-main" onClick={onOpen} type="button">
        <div className="order-heading">
          <div className="status-badge" data-status={order.status}>
            <Icon size={15} />
            {STATUS[order.status]?.label ?? "Pedido"}
          </div>
          <time>{formatTime(order.startedAt)}</time>
        </div>
        <h2>{order.customerName}</h2>
        <p className="seller">
          <UserRound size={14} />
          {order.sellerName}
        </p>
        <ul className="item-preview">
          {visibleItems.map((item, index) => (
            <li key={`${order.id}_${index}`}>
              <strong>{item.quantity ?? "?"}</strong>
              <span>{item.unit ?? ""}</span>
              <p>{item.product_normalized ?? item.product_original}</p>
            </li>
          ))}
        </ul>
        <div className="order-flags">
          {order.needs_review && <Flag icon={AlertTriangle} label="Revisar" />}
          {media.has_audio && <Flag icon={Headphones} label="Audio" />}
          {media.has_images && <Flag icon={ImageIcon} label="Imagen" />}
        </div>
      </button>
      <button className="advance-button" onClick={onAdvance} type="button" aria-label="Avanzar estado">
        <ChevronRight size={20} />
      </button>
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

function OrderDetail({ deleting, onClose, onDelete, onSetItemVariant, onSetStatus, order, updatingItemId }) {
  const media = order.media_processing ?? {};

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
        <button
          className="icon-button delete-button"
          disabled={deleting}
          onClick={onDelete}
          type="button"
          title="Eliminar pedido"
          aria-label="Eliminar pedido"
        >
          <X size={18} />
        </button>
      </div>

      <div className="detail-meta">
        <span>{order.sellerName}</span>
        <span>{formatTime(order.startedAt)}</span>
        <span>{Math.round((order.confidence ?? 0) * 100)}%</span>
      </div>

      <div className="status-actions">
        {["new", "review", "preparing", "delivered"].map((status) => (
          <button
            className={order.status === status ? "selected" : ""}
            data-status={status}
            key={status}
            onClick={() => onSetStatus(status)}
            type="button"
          >
            {STATUS[status].label}
          </button>
        ))}
      </div>

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
                      <button
                        className={item.product_normalized === variant.value ? "selected" : ""}
                        disabled={updatingItemId === item.id}
                        key={variant.value}
                        onClick={() => onSetItemVariant(item, variant.value)}
                        type="button"
                      >
                        {variant.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span>
                {item.quantity ?? "?"} {item.unit ?? ""}
              </span>
            </div>
          ))}
        </div>
      </section>

      {(order.notes.length > 0 || order.questions.length > 0) && (
        <section className="detail-section">
          <h3>Notas</h3>
          {[...order.notes, ...order.questions].map((note, index) => (
            <p className="note" key={`${order.id}_note_${index}`}>
              {note}
            </p>
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
          <h3>WhatsApp</h3>
          <pre>{order.originalText}</pre>
        </section>
      )}
    </div>
  );
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
      {!isImage && !isAudio && (
        <a href={source} rel="noreferrer" target="_blank">
          Abrir archivo
        </a>
      )}
      <p>{filename}</p>
    </div>
  );
}
