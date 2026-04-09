import { useEffect, useState, useMemo, useCallback } from "react";
import { db } from "../firbase/Firebase";
import {
  collection,
  query,
  orderBy,
  getDocs,
  addDoc,
} from "firebase/firestore";
import "./Menus.css";

const CACHE_KEY = "rita_usuarios_cache";
const CACHE_TS_KEY = "rita_usuarios_ts";
const CACHE_TTL = 1000 * 60 * 60;
const PAGE_SIZE = 5;
const colRef = collection(db, "UsuariosActivos");

const MEAL_ORDER = ["desayuno", "snack1", "almuerzo", "snack2", "cena"];
const MEAL_LABELS = {
  desayuno: { icon: "☀️", label: "Desayuno" },
  snack1: { icon: "🍎", label: "Snack 1" },
  almuerzo: { icon: "🍲", label: "Almuerzo" },
  snack2: { icon: "🥜", label: "Snack 2" },
  cena: { icon: "🌙", label: "Cena" },
};

// Map delivery comida names → menu keys
const COMIDA_TO_MEAL = {
  desayuno: "desayuno",
  snack_manana: "snack1",
  almuerzo: "almuerzo",
  snack_tarde: "snack2",
  cena: "cena",
};

const PERIODO_LABELS = {
  manana: "🌅 Mañana",
  tarde: "🌇 Tarde",
  noche: "🌙 Noche",
};

const DAY_LABELS = {
  dia1: "Lunes",
  dia2: "Martes",
  dia3: "Miércoles",
  dia4: "Jueves",
  dia5: "Viernes",
};

// ── Cache helpers (shared with Dashboard) ──
const loadCache = () => {
  const raw = localStorage.getItem(CACHE_KEY);
  const ts = localStorage.getItem(CACHE_TS_KEY);
  if (!raw || !ts) return null;
  if (Date.now() - Number(ts) > CACHE_TTL) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};
const saveCache = (data) => {
  localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  localStorage.setItem(CACHE_TS_KEY, Date.now().toString());
};

// ── Helpers ──
const getEmail = (u) =>
  u.datapayphone?.email || u.datapayphone?.optionalParameter2 || "—";
const getPhone = (u) =>
  u.datapayphone?.optionalParameter1 || u.datapayphone?.phoneNumber || "—";
const getName = (u) => u.datapayphone?.optionalParameter4 || "Sin nombre";
const getPlan = (cart) => cart?.nombre || "Sin plan";

// ── Meal Card ──
function MealCard({ mealKey, meal, checked, onToggle }) {
  const info = MEAL_LABELS[mealKey] || { icon: "🍽️", label: mealKey };
  const ingredientes = meal.ingredientes || {};

  return (
    <div className={`meal-card ${checked ? "meal-done" : ""}`}>
      <div className="meal-header">
        <span className="meal-type">
          {info.icon} {info.label}
        </span>
        <label className="meal-check" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={checked} onChange={onToggle} />
          <span className="check-label">
            {checked ? "✅ Listo" : "Preparado"}
          </span>
        </label>
      </div>

      <div className="meal-name">{meal.nombre}</div>

      {meal.descripcion && <div className="meal-desc">{meal.descripcion}</div>}

      <div className="meal-calories-row">
        🔥 {meal.calorias || 0} kcal
        {meal.proteinas?.total != null && (
          <span> · 💪 {meal.proteinas.total}g proteína</span>
        )}
      </div>

      {/* Ingredientes - grande y claro para el chef */}
      {Object.keys(ingredientes).length > 0 && (
        <div className="meal-ingredients">
          <div className="ingredients-title">🧾 INGREDIENTES</div>
          <ul className="ingredients-list-chef">
            {Object.entries(ingredientes).map(([name, qty]) => (
              <li key={name} className="ingredient-row">
                <span className="ing-name">{name}</span>
                <span className="ing-qty">{qty}g</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Get current day key based on today's weekday ──
const getCurrentDayKey = () => {
  const dayMap = [null, "dia1", "dia2", "dia3", "dia4", "dia5", null]; // Dom=0, Lun=1...Sab=6
  return dayMap[new Date().getDay()] || "dia1";
};

// ── Delivery Group with collapsible meals ──
function DeliveryGroup({
  group,
  currentDay,
  dayDispatch,
  readyMeals,
  activeDay,
  onDispatchChange,
  onMarkReady,
  userId,
}) {
  const [open, setOpen] = useState(false);
  const allChecked = group.meals.every((m) => dayDispatch[m]);
  const allReady = group.meals.every((m) => readyMeals[`${activeDay}_${m}`]);
  const checkedCount = group.meals.filter((m) => dayDispatch[m]).length;

  return (
    <div className={`delivery-group ${group.label ? "multi" : "single"}`}>
      {group.label ? (
        <div className="delivery-group-header" onClick={() => setOpen(!open)}>
          <div className="delivery-group-left">
            <span className={`delivery-group-toggle ${open ? "open" : ""}`}>
              ▶
            </span>
            <span className="delivery-group-label">📦 {group.label}</span>
            <span className="delivery-group-count">
              {checkedCount}/{group.meals.length} listos
            </span>
          </div>
          <div className="delivery-group-right">
            {group.horaExacta && (
              <span className="delivery-group-time">
                🕐 {group.horaExacta}
                {group.periodo &&
                  ` · ${PERIODO_LABELS[group.periodo] || group.periodo}`}
              </span>
            )}
            {allReady && (
              <span className="delivery-group-badge-done">✅ Entregado</span>
            )}
          </div>
        </div>
      ) : (
        <div className="delivery-group-header" onClick={() => setOpen(!open)}>
          <div className="delivery-group-left">
            <span className={`delivery-group-toggle ${open ? "open" : ""}`}>
              ▶
            </span>
            <span className="delivery-group-label">
              {MEAL_LABELS[group.meals[0]]?.icon}{" "}
              {MEAL_LABELS[group.meals[0]]?.label || group.meals[0]}
            </span>
          </div>
          <div className="delivery-group-right">
            {allReady && (
              <span className="delivery-group-badge-done">✅ Entregado</span>
            )}
          </div>
        </div>
      )}

      {open && (
        <div className="delivery-group-body">
          {group.meals.map((mealKey) => (
            <MealCard
              key={mealKey}
              mealKey={mealKey}
              meal={currentDay[mealKey]}
              checked={!!dayDispatch[mealKey]}
              onToggle={() => onDispatchChange(userId, activeDay, mealKey)}
            />
          ))}
        </div>
      )}

      {/* Single delivery button per group */}
      {allChecked && !allReady && (
        <div className="group-ready-row">
          <button
            className="btn-ready-meal"
            onClick={() =>
              group.meals.forEach((m) => onMarkReady(userId, activeDay, m))
            }
          >
            📦 Entregar a delivery
            {group.meals.length > 1 ? ` (${group.meals.length} platos)` : ""}
          </button>
        </div>
      )}
      {allChecked && allReady && (
        <div className="group-ready-row">
          <span className="meal-ready-confirmed">✅ entregado al delivery</span>
        </div>
      )}
    </div>
  );
}

// ── User Menu Section ──
function UserMenuSection({
  user,
  index,
  dispatch,
  onDispatchChange,
  onMarkReady,
  expanded,
  onToggleExpand,
}) {
  const [activeDay, setActiveDay] = useState(() => getCurrentDayKey());

  const menu = user.menu?.menucreado;
  const hasDays = menu && Object.keys(menu).length > 0;
  const days = hasDays ? Object.keys(DAY_LABELS).filter((d) => menu[d]) : [];

  const currentDay = menu?.[activeDay];
  const meals = currentDay ? MEAL_ORDER.filter((m) => currentDay[m]) : [];

  // Count dispatched meals for current day
  const dayDispatch = dispatch?.[activeDay] || {};
  const checkedCount = meals.filter((m) => dayDispatch[m]).length;
  // Per-meal ready state
  const readyMeals = dispatch?._readyMeals || {};

  // Group meals by delivery slot
  const entregas = user.ubicacines?.entregas || [];
  const deliveryGroups = useMemo(() => {
    if (entregas.length === 0) {
      // No delivery info → each meal is its own group
      return meals.map((m) => ({
        key: m,
        label: null,
        horaExacta: null,
        periodo: null,
        meals: [m],
      }));
    }
    const grouped = [];
    const assigned = new Set();
    entregas.forEach((ent, idx) => {
      const mealKeys = (ent.comidas || [])
        .map((c) => COMIDA_TO_MEAL[c] || c)
        .filter((m) => currentDay?.[m]);
      if (mealKeys.length === 0) return;
      mealKeys.forEach((m) => assigned.add(m));
      // Sort by MEAL_ORDER
      mealKeys.sort((a, b) => MEAL_ORDER.indexOf(a) - MEAL_ORDER.indexOf(b));
      grouped.push({
        key: `delivery-${idx}`,
        label: mealKeys.map((m) => MEAL_LABELS[m]?.label || m).join(" + "),
        horaExacta: ent.horaExacta,
        periodo: ent.periodo,
        meals: mealKeys,
      });
    });
    // Any meals not in a delivery group get their own card
    meals.forEach((m) => {
      if (!assigned.has(m)) {
        grouped.push({
          key: m,
          label: null,
          horaExacta: null,
          periodo: null,
          meals: [m],
        });
      }
    });
    return grouped;
  }, [entregas, meals, currentDay, activeDay]);

  return (
    <div
      id={`user-card-${user.id}`}
      className={`menu-user-card ${Object.keys(readyMeals).length > 0 ? "user-ready" : ""}`}
    >
      <div className="menu-user-header" onClick={onToggleExpand}>
        <div className="menu-user-info">
          <span className="user-number">{index + 1}</span>
          <div className="user-details">
            <span className="user-name">{getEmail(user)}</span>
            <span className="user-phone">📞 {getPhone(user)}</span>
          </div>
        </div>
        <div className="menu-user-meta">
          <span className="delivery-counter">
            🚚 {Object.keys(readyMeals).length}/25 entregados
          </span>
          <span
            className={`badge ${getPlan(user.cart) === "Plan Premium" ? "badge-premium" : "badge-starter"}`}
          >
            {getPlan(user.cart)}
          </span>
          <span className={`toggle-icon ${expanded ? "open" : ""}`}>▼</span>
        </div>
      </div>

      {expanded && (
        <>
          {!hasDays ? (
            <div className="no-menu-msg">
              Este usuario aún no tiene menú asignado.
            </div>
          ) : (
            <>
              {/* Day tabs */}
              <div className="day-tabs-wrapper">
                <div className="day-tabs">
                  {days.map((day) => {
                    const dd = dispatch?.[day] || {};
                    const dayMeals = menu[day]
                      ? MEAL_ORDER.filter((m) => menu[day][m])
                      : [];
                    const dayDone =
                      dayMeals.length > 0 && dayMeals.every((m) => dd[m]);
                    return (
                      <button
                        key={day}
                        className={`day-tab ${activeDay === day ? "active" : ""} ${dayDone ? "day-done" : ""}`}
                        onClick={() => setActiveDay(day)}
                      >
                        {dayDone && "✅ "}
                        {DAY_LABELS[day]}
                      </button>
                    );
                  })}
                </div>

                <div className="day-progress">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: meals.length
                          ? `${(checkedCount / meals.length) * 100}%`
                          : "0%",
                      }}
                    />
                  </div>
                  <span className="progress-text">
                    {checkedCount}/{meals.length} platos listos
                  </span>
                </div>
              </div>

              {/* Meals grouped by delivery */}
              <div className="meals-grid">
                {deliveryGroups.map((group) => (
                  <DeliveryGroup
                    key={group.key}
                    group={group}
                    currentDay={currentDay}
                    dayDispatch={dayDispatch}
                    readyMeals={readyMeals}
                    activeDay={activeDay}
                    onDispatchChange={onDispatchChange}
                    onMarkReady={onMarkReady}
                    userId={user.id}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Main Component ──
function Menus() {
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [busqueda, setBusqueda] = useState("");
  const [expandedUserId, setExpandedUserId] = useState(null);
  // dispatch state: { [userId]: { dia1: { desayuno: true, ... }, _ready: false } }
  const [dispatchState, setDispatchState] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("rita_dispatch") || "{}");
    } catch {
      return {};
    }
  });

  // Persist dispatch to localStorage
  const saveDispatch = useCallback((newState) => {
    setDispatchState(newState);
    localStorage.setItem("rita_dispatch", JSON.stringify(newState));
  }, []);

  const handleDispatchChange = useCallback((userId, day, mealKey) => {
    setDispatchState((prev) => {
      const userState = { ...prev[userId] };
      const dayState = { ...(userState[day] || {}) };
      dayState[mealKey] = !dayState[mealKey];
      userState[day] = dayState;
      const next = { ...prev, [userId]: userState };
      localStorage.setItem("rita_dispatch", JSON.stringify(next));
      return next;
    });
  }, []);

  const handleMarkReady = useCallback(
    (userId, day, mealKey) => {
      // Guardar en log de entregas con info del usuario y plato
      const user = allUsers.find((u) => u.id === userId);
      const mealData = user?.menu?.menucreado?.[day]?.[mealKey];
      const entrega = {
        userId,
        email: getEmail(user),
        telefono: getPhone(user),
        nombre: getName(user),
        plan: getPlan(user?.cart),
        dia: DAY_LABELS[day] || day,
        comida: MEAL_LABELS[mealKey]?.label || mealKey,
        plato: mealData?.nombre || "—",
        fecha: new Date().toISOString(),
      };

      // Guardar en localStorage
      try {
        const entregas = JSON.parse(
          localStorage.getItem("rita_entregas") || "[]",
        );
        entregas.push(entrega);
        localStorage.setItem("rita_entregas", JSON.stringify(entregas));
      } catch {
        /* ignore */
      }

      // ── Actualizar bodega (localStorage: bodega_ingredientes) ──
      try {
        // Leer ingredientes de la bodega
        const bodega = JSON.parse(
          localStorage.getItem("bodega_ingredientes") || "[]",
        );
        const ingredientesUsados = mealData?.ingredientes || {};
        let bodegaActualizada = [...bodega];
        Object.entries(ingredientesUsados).forEach(
          ([nombreIng, cantidadUsada]) => {
            // Buscar ingrediente en bodega (por nombre, case-insensitive)
            const idx = bodegaActualizada.findIndex(
              (i) =>
                i.nombre && i.nombre.toLowerCase() === nombreIng.toLowerCase(),
            );
            if (idx !== -1) {
              // Si existe, restar la cantidad usada (no dejar negativo)
              bodegaActualizada[idx] = {
                ...bodegaActualizada[idx],
                cantidad: Math.max(
                  0,
                  (parseFloat(bodegaActualizada[idx].cantidad) || 0) -
                    (parseFloat(cantidadUsada) || 0),
                ),
              };
            } else {
              // Si no existe, agregarlo con cantidad usada y costo/costoPorUnidad en 0
              bodegaActualizada.push({
                id: Date.now().toString() + Math.random().toString(36).slice(2),
                nombre: nombreIng,
                cantidad: parseFloat(cantidadUsada) || 0,
                costoTotal: 0,
                costoPorUnidad: 0,
                unidad: "g",
                createdAt: new Date().toISOString(),
              });
            }
          },
        );
        localStorage.setItem(
          "bodega_ingredientes",
          JSON.stringify(bodegaActualizada),
        );
      } catch (err) {
        console.error("Error actualizando bodega:", err);
      }

      // Guardar en Firebase colección platoslistos
      addDoc(collection(db, "platoslistos"), entrega).catch((err) =>
        console.error("Error guardando en platoslistos:", err),
      );

      setDispatchState((prev) => {
        const userState = { ...prev[userId] };
        const readyMeals = { ...(userState._readyMeals || {}) };
        readyMeals[`${day}_${mealKey}`] = true;
        userState._readyMeals = readyMeals;
        let next = { ...prev, [userId]: userState };

        // Reset only this user when they reach 25 delivered meals
        if (Object.keys(readyMeals).length >= 25) {
          const { [userId]: _, ...rest } = next;
          next = rest;
        }

        localStorage.setItem("rita_dispatch", JSON.stringify(next));
        return next;
      });
    },
    [allUsers],
  );

  const fetchAll = async () => {
    setLoading(true);
    const q = query(colRef, orderBy("createdAt"));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    saveCache(data);
    setAllUsers(data);
    setLoading(false);
  };

  useEffect(() => {
    const cached = loadCache();
    if (cached) {
      setAllUsers(cached);
    } else {
      fetchAll();
    }
  }, []);

  const handleRefresh = () => {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_TS_KEY);
    setPage(1);
    fetchAll();
  };

  // Only users that have menus
  const usersWithMenus = useMemo(() => {
    return allUsers.filter((u) => u.menu?.menucreado);
  }, [allUsers]);

  const filtered = useMemo(() => {
    if (!busqueda.trim()) return usersWithMenus;
    const q = busqueda.toLowerCase();
    return usersWithMenus.filter(
      (u) =>
        (u.datapayphone?.email || "").toLowerCase().includes(q) ||
        (u.datapayphone?.optionalParameter2 || "").toLowerCase().includes(q) ||
        (u.datapayphone?.optionalParameter1 || "").includes(q) ||
        (u.datapayphone?.optionalParameter4 || "").toLowerCase().includes(q) ||
        (u.datapayphone?.phoneNumber || "").includes(q),
    );
  }, [usersWithMenus, busqueda]);

  const usuarios = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = usuarios.length < filtered.length;

  return (
    <div className="menus-page">
      <header>
        <div className="header-row">
          <div>
            <h1>🍽️ Menús por Usuario</h1>
            <p className="subtitle">
              Platos, ingredientes y nutrición — {usersWithMenus.length}{" "}
              usuarios con menú
            </p>
          </div>
          <button
            className="btn-refresh"
            onClick={handleRefresh}
            disabled={loading}
          >
            {loading ? "⏳ Actualizando..." : "↻ Actualizar datos"}
          </button>
        </div>
      </header>

      <div className="menus-toolbar">
        <input
          className="search-input"
          type="text"
          placeholder="🔍 Buscar por nombre, email o teléfono..."
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value);
            setPage(1);
          }}
        />
        <span className="result-count">
          {filtered.length} usuario{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {loading && <div className="menus-loading">⏳ Cargando datos...</div>}

      {!loading && filtered.length === 0 && (
        <div className="menus-empty">No se encontraron usuarios con menú</div>
      )}

      {usuarios.map((u, i) => (
        <UserMenuSection
          key={u.id}
          user={u}
          index={i}
          dispatch={dispatchState[u.id]}
          onDispatchChange={handleDispatchChange}
          onMarkReady={handleMarkReady}
          expanded={expandedUserId === u.id}
          onToggleExpand={() => {
            const newId = expandedUserId === u.id ? null : u.id;
            setExpandedUserId(newId);
            if (newId) {
              setTimeout(() => {
                document
                  .getElementById(`user-card-${u.id}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }, 50);
            }
          }}
        />
      ))}

      {hasMore && (
        <button className="btn-more" onClick={() => setPage((p) => p + 1)}>
          Cargar más ({filtered.length - usuarios.length} restantes)
        </button>
      )}
    </div>
  );
}

export default Menus;
