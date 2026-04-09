import { useState, useEffect, useMemo, useCallback } from "react";
import { db } from "../firbase/Firebase";
import { collection, getDocs, doc, deleteDoc } from "firebase/firestore";
import "./Deliveries.css";

const CACHE_KEY = "rita_usuarios_cache";
const ENTREGAS_KEY = "rita_entregas";

const COMIDA_LABELS = {
  desayuno: { icon: "☀️", label: "Desayuno" },
  snack_manana: { icon: "🍎", label: "Snack Mañana" },
  snack1: { icon: "🍎", label: "Snack 1" },
  almuerzo: { icon: "🍲", label: "Almuerzo" },
  snack_tarde: { icon: "🥜", label: "Snack Tarde" },
  snack2: { icon: "🥜", label: "Snack 2" },
  cena: { icon: "🌙", label: "Cena" },
};

// Map entrega comida names → the label saved in rita_entregas by Menus.jsx (MEAL_LABELS)
// Menus.jsx saves: MEAL_LABELS[mealKey].label where mealKey ∈ {desayuno, snack1, almuerzo, snack2, cena}
// Delivery data has comidas like: desayuno, snack_manana, almuerzo, snack_tarde, cena
const COMIDA_TO_ENTREGAS_LABEL = {
  desayuno: "Desayuno",
  snack_manana: "Snack 1",
  snack1: "Snack 1",
  almuerzo: "Almuerzo",
  snack_tarde: "Snack 2",
  snack2: "Snack 2",
  cena: "Cena",
};

// Also build reverse: from rita_entregas label → normalized key for flexible matching
const ENTREGAS_LABEL_NORMALIZE = {
  Desayuno: "desayuno",
  "Snack 1": "snack1",
  "Snack Mañana": "snack1",
  Almuerzo: "almuerzo",
  "Snack 2": "snack2",
  "Snack Tarde": "snack2",
  Cena: "cena",
};

const loadCache = () => {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

const loadEntregas = () => {
  try {
    return JSON.parse(localStorage.getItem(ENTREGAS_KEY) || "[]");
  } catch {
    return [];
  }
};

const getEmail = (u) =>
  u.datapayphone?.email || u.datapayphone?.optionalParameter2 || "Sin email";
const getPhone = (u) =>
  u.datapayphone?.optionalParameter1 || u.datapayphone?.phoneNumber || "";

function Deliveries() {
  const [allUsers] = useState(() => loadCache());
  // rita_entregas = platos listos en cocina (no entregados aún)
  const [entregasListas, setEntregasListas] = useState(() => loadEntregas());
  const [busqueda, setBusqueda] = useState("");
  const [filtroTab, setFiltroTab] = useState("todos");
  const [entregados, setEntregados] = useState([]);

  // Si no hay datos en localStorage, cargar desde Firebase
  useEffect(() => {
    const local = localStorage.getItem(ENTREGAS_KEY);
    if (!local || local) {
      getDocs(collection(db, "platoslistos"))
        .then((snapshot) => {
          const data = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }));
          if (data.length > 0) {
            setEntregasListas(data);
            localStorage.setItem(ENTREGAS_KEY, JSON.stringify(data));
          }
        })
        .catch((err) => console.error("Error cargando platoslistos:", err));
    }
  }, []);

  // Build a Set of "userId_comida" keys for fast lookup of kitchen-ready meals
  const entregasSet = useMemo(() => {
    const set = new Map();
    entregasListas.forEach((e, idx) => {
      // key: unique combo to match with delivery comidas
      const key = `${e.userId}_${e.comida}`;
      set.set(key, idx);
    });
    return set;
  }, [entregasListas]);

  // Mark delivery as done: remove from rita_entregas
  const handleHacerEntrega = useCallback((entregaIndex) => {
    setEntregasListas((prev) => {
      const removed = prev[entregaIndex];
      const next = prev.filter((_, i) => i !== entregaIndex);
      localStorage.setItem(ENTREGAS_KEY, JSON.stringify(next));
      if (removed?.id) {
        deleteDoc(doc(db, "platoslistos", removed.id)).catch((err) =>
          console.error("Error eliminando de platoslistos:", err),
        );
      }
      return next;
    });
  }, []);

  // Mark ALL comidas of a delivery group as delivered at once
  const handleEntregarTodo = useCallback((indices, deliveryData) => {
    // Add to entregados section
    setEntregados((prev) => [
      ...prev,
      { ...deliveryData, entregadoAt: new Date().toLocaleTimeString() },
    ]);

    setEntregasListas((prev) => {
      const toRemove = new Set(indices);
      prev.forEach((item, i) => {
        if (toRemove.has(i) && item?.id) {
          deleteDoc(doc(db, "platoslistos", item.id)).catch((err) =>
            console.error("Error eliminando de platoslistos:", err),
          );
        }
      });
      const next = prev.filter((_, i) => !toRemove.has(i));
      localStorage.setItem(ENTREGAS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Flatten all entregas into individual delivery items, sorted by hour
  const allDeliveries = useMemo(() => {
    const items = [];
    for (const u of allUsers) {
      const entregas = u.ubicacines?.entregas;
      if (!entregas?.length) continue;
      for (const e of entregas) {
        // For each comida, check if it's in rita_entregas (listo en cocina)
        const comidaStatuses = (e.comidas || []).map((c) => {
          const info = COMIDA_LABELS[c] || { icon: "🍽️", label: c };
          // Normalize delivery comida to a canonical key
          const normalizedKey = COMIDA_TO_ENTREGAS_LABEL[c]
            ? ENTREGAS_LABEL_NORMALIZE[COMIDA_TO_ENTREGAS_LABEL[c]] || c
            : c;
          // Find matching entry in rita_entregas by userId + normalized comida key
          const entregaIdx = entregasListas.findIndex((el) => {
            if (el.userId !== u.id) return false;
            // Normalize the stored label to the same canonical key
            const storedKey = ENTREGAS_LABEL_NORMALIZE[el.comida] || el.comida;
            return storedKey === normalizedKey;
          });
          return {
            comida: c,
            ...info,
            listoEnCocina: entregaIdx !== -1,
            entregaIndex: entregaIdx,
          };
        });

        const allReady =
          comidaStatuses.length > 0 &&
          comidaStatuses.every((s) => s.listoEnCocina);
        const anyReady = comidaStatuses.some((s) => s.listoEnCocina);
        const readyIndices = comidaStatuses
          .filter((s) => s.listoEnCocina)
          .map((s) => s.entregaIndex);

        items.push({
          userId: u.id,
          email: getEmail(u),
          phone: getPhone(u),
          plan: u.cart?.nombre || "Sin plan",
          periodo: e.periodo || "manana",
          horaExacta: e.horaExacta || "00:00",
          codigo: e.codigo || "",
          ubicacion: e.ubicacion,
          comidaStatuses,
          allReady,
          anyReady,
          readyIndices,
        });
      }
    }
    items.sort((a, b) => a.horaExacta.localeCompare(b.horaExacta));

    // Exclude items already in entregados
    const entregadosKeys = new Set(
      entregados.map((e) => `${e.userId}_${e.codigo}_${e.horaExacta}`),
    );
    return items.filter(
      (d) => !entregadosKeys.has(`${d.userId}_${d.codigo}_${d.horaExacta}`),
    );
  }, [allUsers, entregasListas, entregados]);

  // Filter by search
  const searchFiltered = useMemo(() => {
    if (!busqueda.trim()) return allDeliveries;
    const q = busqueda.toLowerCase();
    return allDeliveries.filter(
      (d) =>
        d.email.toLowerCase().includes(q) ||
        d.phone.includes(q) ||
        d.codigo.includes(q) ||
        d.ubicacion?.direccion?.toLowerCase().includes(q),
    );
  }, [allDeliveries, busqueda]);

  // Group by periodo
  const manana = useMemo(
    () => searchFiltered.filter((d) => d.periodo === "manana"),
    [searchFiltered],
  );
  const tarde = useMemo(
    () => searchFiltered.filter((d) => d.periodo === "tarde"),
    [searchFiltered],
  );

  const displayed =
    filtroTab === "manana"
      ? manana
      : filtroTab === "tarde"
        ? tarde
        : searchFiltered;

  // Counts
  const readyCount = allDeliveries.filter((d) => d.allReady).length;
  const pendingCount = allDeliveries.filter((d) => !d.allReady).length;

  // When no more pending deliveries and there are entregados, reset everything
  useEffect(() => {
    if (allDeliveries.length === 0 && entregados.length > 0) {
      const timer = setTimeout(() => {
        setEntregados([]);
        // Reload entregas from Firebase
        getDocs(collection(db, "platoslistos"))
          .then((snapshot) => {
            const data = snapshot.docs.map((d) => ({
              id: d.id,
              ...d.data(),
            }));
            setEntregasListas(data);
            localStorage.setItem(ENTREGAS_KEY, JSON.stringify(data));
          })
          .catch((err) => console.error("Error recargando platoslistos:", err));
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [allDeliveries.length, entregados.length]);

  return (
    <div className="deliveries">
      <header className="deliveries-header">
        <h1>🚚 Entregas del Día</h1>
        <p className="subtitle">
          Organizadas por hora — platos listos en cocina se marcan desde Menús
        </p>
      </header>

      {/* ── CARDS ── */}
      <div className="del-cards">
        <div className="del-card">
          <div className="del-card-icon">📦</div>
          <div className="del-card-info">
            <span className="del-card-label">Total Entregas</span>
            <span className="del-card-value accent">
              {allDeliveries.length}
            </span>
          </div>
        </div>
        <div className="del-card">
          <div className="del-card-icon">✅</div>
          <div className="del-card-info">
            <span className="del-card-label">Listas en cocina</span>
            <span className="del-card-value success">{readyCount}</span>
          </div>
        </div>
        <div className="del-card">
          <div className="del-card-icon">⏳</div>
          <div className="del-card-info">
            <span className="del-card-label">Pendientes cocina</span>
            <span className="del-card-value danger">{pendingCount}</span>
          </div>
        </div>
        <div className="del-card">
          <div className="del-card-icon">🌅</div>
          <div className="del-card-info">
            <span className="del-card-label">Mañana / Tarde</span>
            <span className="del-card-value premium">
              {manana.length} / {tarde.length}
            </span>
          </div>
        </div>
      </div>

      {/* ── PERIOD TABS ── */}
      <div className="del-tabs">
        <button
          className={`del-tab ${filtroTab === "todos" ? "active" : ""}`}
          onClick={() => setFiltroTab("todos")}
        >
          Todas ({searchFiltered.length})
        </button>
        <button
          className={`del-tab del-tab-manana ${filtroTab === "manana" ? "active" : ""}`}
          onClick={() => setFiltroTab("manana")}
        >
          🌅 Mañana ({manana.length})
        </button>
        <button
          className={`del-tab del-tab-tarde ${filtroTab === "tarde" ? "active" : ""}`}
          onClick={() => setFiltroTab("tarde")}
        >
          🌇 Tarde ({tarde.length})
        </button>
      </div>

      {/* ── SEARCH ── */}
      <div className="del-toolbar">
        <input
          className="del-search"
          type="text"
          placeholder="🔍 Buscar por email, teléfono, código o dirección..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <span className="del-result-count">
          {displayed.length} entrega{displayed.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── DELIVERY LIST ── */}
      {displayed.length === 0 ? (
        <div className="del-empty">
          <div className="del-empty-icon">📭</div>
          <h2>No hay entregas</h2>
          <p>
            {allUsers.length === 0
              ? "No hay datos en caché. Ve al Panel de Control primero."
              : "Ninguna entrega coincide con tu búsqueda."}
          </p>
        </div>
      ) : (
        <div className="del-list">
          {filtroTab === "todos" && manana.length > 0 && (
            <div className="del-section-title">
              <span className="del-section-icon">🌅</span> Entregas Mañana
              <span className="del-section-count">{manana.length}</span>
            </div>
          )}
          {(filtroTab === "todos"
            ? manana
            : filtroTab === "manana"
              ? manana
              : []
          ).map((d, i) => (
            <DeliveryCard
              key={`m-${i}`}
              delivery={d}
              onHacerEntrega={handleHacerEntrega}
              onEntregarTodo={handleEntregarTodo}
            />
          ))}

          {filtroTab === "todos" && tarde.length > 0 && (
            <div className="del-section-title del-section-tarde">
              <span className="del-section-icon">🌇</span> Entregas Tarde
              <span className="del-section-count">{tarde.length}</span>
            </div>
          )}
          {(filtroTab === "todos"
            ? tarde
            : filtroTab === "tarde"
              ? tarde
              : []
          ).map((d, i) => (
            <DeliveryCard
              key={`t-${i}`}
              delivery={d}
              onHacerEntrega={handleHacerEntrega}
              onEntregarTodo={handleEntregarTodo}
            />
          ))}
        </div>
      )}

      {/* ── PRODUCTOS ENTREGADOS ── */}
      {entregados.length > 0 && (
        <div className="del-entregados-section">
          <div className="del-section-title del-section-entregados">
            <span className="del-section-icon">✅</span> Productos Entregados
            <span className="del-section-count">{entregados.length}</span>
          </div>
          <div className="del-list">
            {entregados.map((d, i) => (
              <div key={`e-${i}`} className="del-card-entrega del-entregado">
                <div className="del-card-entrega-left">
                  <div className="del-hora-big">{d.horaExacta}</div>
                  <span
                    className={`del-periodo-badge del-periodo-${d.periodo}`}
                  >
                    {d.periodo === "manana" ? "🌅 Mañana" : "🌇 Tarde"}
                  </span>
                </div>
                <div className="del-card-entrega-center">
                  <div className="del-card-entrega-user">
                    <span className="del-user-email-inline">{d.email}</span>
                    {d.phone && (
                      <span className="del-user-phone-inline">
                        📞 {d.phone}
                      </span>
                    )}
                    <span
                      className={`del-badge-sm ${d.plan === "Plan Premium" ? "del-badge-premium" : "del-badge-starter"}`}
                    >
                      {d.plan}
                    </span>
                  </div>
                  <div className="del-comidas-status">
                    {d.comidaStatuses.map((c, ci) => (
                      <div
                        key={ci}
                        className="del-comida-item del-comida-delivered"
                      >
                        <span className="del-comida-icon">{c.icon}</span>
                        <span className="del-comida-name">{c.label}</span>
                        <span className="del-comida-status-badge">
                          ✅ Entregado
                        </span>
                      </div>
                    ))}
                  </div>
                  {d.ubicacion && (
                    <div className="del-ubicacion">
                      <span className="del-ubicacion-icon">📍</span>
                      <span>{d.ubicacion.direccion || "Sin dirección"}</span>
                    </div>
                  )}
                </div>
                <div className="del-card-entrega-right">
                  <span className="del-codigo"># {d.codigo}</span>
                  <div className="del-status-overall del-all-delivered">
                    ✅ Entregado
                  </div>
                  <span className="del-entregado-time">🕐 {d.entregadoAt}</span>
                </div>
              </div>
            ))}
          </div>
          {allDeliveries.length === 0 && (
            <div className="del-reset-notice">
              <p>
                🎉 ¡Todas las entregas completadas! Reiniciando en 3 segundos...
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DeliveryCard({ delivery: d, onHacerEntrega, onEntregarTodo }) {
  const handleNavegar = () => {
    const loc = d.ubicacion;
    if (loc?.lat && loc?.lng) {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`,
        "_blank",
      );
    } else if (loc?.direccion) {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(loc.direccion)}`,
        "_blank",
      );
    }
  };

  const handleAvisarLlegada = () => {
    const tel = d.phone?.replace(/\D/g, "");
    const msg = encodeURIComponent(
      `¡Hola! 🚚 Tu comida de Rita ha llegado. Por favor recógela. Código: #${d.codigo}`,
    );
    if (tel) {
      window.open(`https://wa.me/${tel}?text=${msg}`, "_blank");
    } else {
      alert("Este usuario no tiene número de teléfono registrado.");
    }
  };

  return (
    <div className={`del-card-entrega ${d.allReady ? "del-ready" : ""}`}>
      <div className="del-card-entrega-left">
        <div className="del-hora-big">{d.horaExacta}</div>
        <span className={`del-periodo-badge del-periodo-${d.periodo}`}>
          {d.periodo === "manana" ? "🌅 Mañana" : "🌇 Tarde"}
        </span>
      </div>

      <div className="del-card-entrega-center">
        <div className="del-card-entrega-user">
          <span className="del-user-email-inline">{d.email}</span>
          {d.phone && (
            <span className="del-user-phone-inline">📞 {d.phone}</span>
          )}
          <span
            className={`del-badge-sm ${d.plan === "Plan Premium" ? "del-badge-premium" : "del-badge-starter"}`}
          >
            {d.plan}
          </span>
        </div>

        {/* Comidas con estado cocina */}
        <div className="del-comidas-status">
          {d.comidaStatuses.map((c, ci) => (
            <div
              key={ci}
              className={`del-comida-item ${
                c.listoEnCocina ? "del-comida-ready" : "del-comida-pending"
              }`}
            >
              <span className="del-comida-icon">{c.icon}</span>
              <span className="del-comida-name">{c.label}</span>
              <span className="del-comida-status-badge">
                {c.listoEnCocina ? "👨‍🍳 Listo" : "⏳ En cocina"}
              </span>
              {c.listoEnCocina && (
                <div
                  className="del-btn-entregar-comida"
                  title="Marcar esta comida como entregada"
                >
                  ✓
                </div>
              )}
            </div>
          ))}
        </div>

        {d.ubicacion && (
          <div className="del-ubicacion">
            <span className="del-ubicacion-icon">📍</span>
            <span>{d.ubicacion.direccion || "Sin dirección"}</span>
            {d.ubicacion.referencia && (
              <span className="del-referencia">
                {" "}
                — Ref: {d.ubicacion.referencia}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="del-card-entrega-right">
        <span className="del-codigo"># {d.codigo}</span>
        <div
          className={`del-status-overall ${d.allReady ? "del-all-ready" : d.anyReady ? "del-partial" : "del-none-ready"}`}
        >
          {d.allReady ? "✅ Lista" : d.anyReady ? "🔶 Parcial" : "🔴 No lista"}
        </div>
        <div className="del-action-buttons">
          {d.ubicacion && (d.ubicacion.lat || d.ubicacion.direccion) && (
            <button
              className="del-btn-navegar"
              onClick={handleNavegar}
              title="Abrir en Google Maps para navegar"
            >
              🗺️ Navegar
            </button>
          )}
          <button
            className="del-btn-avisar"
            onClick={handleAvisarLlegada}
            title="Avisar al usuario por WhatsApp que llegó su comida"
          >
            📲 Avisar llegada
          </button>
          {d.allReady && (
            <button
              className="del-btn-entregar"
              onClick={() => onEntregarTodo(d.readyIndices, d)}
            >
              🚚 Hacer entrega
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default Deliveries;
