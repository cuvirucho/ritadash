import { useEffect, useState, useMemo, useCallback } from "react";
import { db } from "../firbase/Firebase";
import { collection, onSnapshot, addDoc } from "firebase/firestore";
import { normalizarUsuario } from "../services/usuarios";
import "./Menus.css";

const PAGE_SIZE = 5;
const colRef = collection(db, "UsuariosActivos");

// Los menús nuevos usan las claves `snack` y `bebida`; los legados, snack1/snack2.
const MEAL_ORDER = [
  "desayuno",
  "snack1",
  "snack",
  "almuerzo",
  "bebida",
  "snack2",
  "cena",
];
const MEAL_LABELS = {
  desayuno: { icon: "☀️", label: "Desayuno" },
  snack1: { icon: "🍎", label: "Snack 1" },
  snack: { icon: "🍎", label: "Snack" },
  almuerzo: { icon: "🍲", label: "Almuerzo" },
  bebida: { icon: "🥤", label: "Bebida" },
  snack2: { icon: "🥜", label: "Snack 2" },
  cena: { icon: "🌙", label: "Cena" },
};

// Map delivery comida names → posibles claves del menú (nuevas y legadas).
// Se usa la primera que exista en el día que se está viendo.
const COMIDA_TO_MEAL = {
  desayuno: ["desayuno"],
  snack_manana: ["snack1", "snack"],
  almuerzo: ["almuerzo"],
  snack_tarde: ["snack2", "snack"],
  bebida: ["bebida"],
  cena: ["cena"],
};

const PERIODO_LABELS = {
  manana: "🌅 Mañana",
  tarde: "🌇 Tarde",
  noche: "🌙 Noche",
};

// Los menús nuevos usan lunes..viernes; los legados, dia1..dia5.
// El orden de este objeto es el orden de las pestañas de día.
const DAY_LABELS = {
  lunes: "Lunes",
  dia1: "Lunes",
  martes: "Martes",
  dia2: "Martes",
  miercoles: "Miércoles",
  dia3: "Miércoles",
  jueves: "Jueves",
  dia4: "Jueves",
  viernes: "Viernes",
  dia5: "Viernes",
};

// Los usuarios llegan ya normalizados (normalizarUsuario): nombre, correo,
// telefono, plan {label, color}, menuCreado y entregas son campos planos.

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

// ── Día de hoy, con la clave que realmente use el menú del usuario ──
const DIA_SEMANA = [
  null,
  ["lunes", "dia1"],
  ["martes", "dia2"],
  ["miercoles", "dia3"],
  ["jueves", "dia4"],
  ["viernes", "dia5"],
  null,
];

const getCurrentDayKey = (menu) => {
  const candidatos = DIA_SEMANA[new Date().getDay()] || ["lunes", "dia1"];
  if (menu) {
    const existente = candidatos.find((k) => menu[k]);
    if (existente) return existente;
    // Fin de semana o el menú no tiene el día de hoy: primer día disponible
    const primero = Object.keys(DAY_LABELS).find((k) => menu[k]);
    if (primero) return primero;
  }
  return candidatos[0];
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
  const menu = user.menuCreado;
  const [activeDay, setActiveDay] = useState(() => getCurrentDayKey(menu));

  // Solo las claves que son días reales; `resumen_semanal` y demás se ignoran.
  const days = menu ? Object.keys(DAY_LABELS).filter((d) => menu[d]) : [];
  const hasDays = days.length > 0;

  const currentDay = menu?.[activeDay];
  const meals = currentDay ? MEAL_ORDER.filter((m) => currentDay[m]) : [];

  // Count dispatched meals for current day
  const dayDispatch = dispatch?.[activeDay] || {};
  const checkedCount = meals.filter((m) => dayDispatch[m]).length;
  // Per-meal ready state
  const readyMeals = dispatch?._readyMeals || {};

  // Group meals by delivery slot
  const entregas = user.entregas || [];
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
        .map((c) => (COMIDA_TO_MEAL[c] || [c]).find((k) => currentDay?.[k]))
        .filter(Boolean);
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
            <span className="user-name">{user.nombre}</span>
            <span className="user-email">✉️ {user.correo}</span>
            <span className="user-phone">📞 {user.telefono}</span>
          </div>
        </div>
        <div className="menu-user-meta">
          <span className="delivery-counter">
            🚚 {Object.keys(readyMeals).length}/25 entregados
          </span>
          <span className={`badge badge-${user.plan.color}`}>
            {user.plan.label}
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
      const mealData = user?.menuCreado?.[day]?.[mealKey];
      const entrega = {
        userId,
        email: user?.correo || "—",
        telefono: user?.telefono || "—",
        nombre: user?.nombre || "Sin nombre",
        plan: user?.plan?.label || "Sin plan",
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

  useEffect(() => {
    setLoading(true);
    // Sin orderBy: Firestore excluye los documentos sin ese campo y los
    // usuarios nuevos no traen createdAt. Se ordena en cliente.
    const unsub = onSnapshot(
      colRef,
      (snapshot) => {
        const data = snapshot.docs
          .map((doc) => normalizarUsuario({ id: doc.id, ...doc.data() }))
          .sort((a, b) => (b.fechaRegistro || 0) - (a.fechaRegistro || 0));
        setAllUsers(data);
        setLoading(false);
      },
      () => {
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  // Only users that have menus
  const usersWithMenus = useMemo(() => {
    return allUsers.filter((u) => u.tieneMenu);
  }, [allUsers]);

  // Users WITHOUT menu assigned
  const usersWithoutMenus = useMemo(() => {
    return allUsers.filter((u) => !u.tieneMenu);
  }, [allUsers]);

  const [notifSent, setNotifSent] = useState({});

  const handleSendReminder = useCallback(async (user) => {
    try {
      await fetch("https://apiapp-gq4hj2kfcq-uc.a.run.app/entregarMensaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          mensaje:
            "Hola " +
            user.nombre +
            ", hemos notado que aún no tienes un menú asignado. Por favor, asigna tu menú a tiempo. ¡Gracias por ser parte de Rita! 🍽️",
        }),
      });
      setNotifSent((prev) => ({ ...prev, [user.id]: true }));
    } catch (err) {
      console.error("Error enviando recordatorio:", err);
    }
  }, []);

  const filtered = useMemo(() => {
    if (!busqueda.trim()) return usersWithMenus;
    const q = busqueda.toLowerCase();
    return usersWithMenus.filter(
      (u) =>
        u.nombre.toLowerCase().includes(q) ||
        u.correo.toLowerCase().includes(q) ||
        u.telefono.toLowerCase().includes(q),
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
          {loading && <span className="btn-refresh">⏳ Cargando...</span>}
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

      {/* ── Usuarios sin menú ── */}
      {!loading && usersWithoutMenus.length > 0 && (
        <div className="no-menu-section">
          <h2 className="no-menu-title">
            ⚠️ Usuarios sin menú asignado ({usersWithoutMenus.length})
          </h2>
          <div className="no-menu-list">
            {usersWithoutMenus.map((u) => (
              <div key={u.id} className="no-menu-user-row">
                <div className="no-menu-user-info">
                  <span className="user-name">{u.nombre}</span>
                  <span className="user-email">✉️ {u.correo}</span>
                  <span className="user-phone">📞 {u.telefono}</span>
                  <span className="user-plan-badge">{u.plan.label}</span>
                </div>
                <button
                  className={`btn-notify ${
                    notifSent[u.id] ? "btn-notify-sent" : ""
                  }`}
                  onClick={() => handleSendReminder(u)}
                  disabled={!!notifSent[u.id]}
                >
                  {notifSent[u.id]
                    ? "✅ Notificación enviada"
                    : "🔔 Enviar recordatorio"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default Menus;
