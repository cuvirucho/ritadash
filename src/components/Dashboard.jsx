import { useEffect, useState, useMemo } from "react";
import { db } from "../firbase/Firebase";
import { collection, query, orderBy, getDocs } from "firebase/firestore";
import "./Dashboard.css";

const CACHE_KEY = "rita_usuarios_cache";
const CACHE_TS_KEY = "rita_usuarios_ts";
const CACHE_TTL = 1000 * 60 * 60; // 1 hora de vigencia
const PAGE_SIZE = 10;
const colRef = collection(db, "UsuariosActivos");

// ── LocalStorage helpers ──
const saveCache = (data) => {
  localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  localStorage.setItem(CACHE_TS_KEY, Date.now().toString());
};

const loadCache = () => {
  const raw = localStorage.getItem(CACHE_KEY);
  const ts = localStorage.getItem(CACHE_TS_KEY);
  if (!raw || !ts) return null;
  if (Date.now() - Number(ts) > CACHE_TTL) return null; // expirado
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

function Dashboard({ onClose }) {
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filtro, setFiltro] = useState("todos");
  const [page, setPage] = useState(1);
  const [busqueda, setBusqueda] = useState("");
  const [autenticado, setAutenticado] = useState(false);
  const [clave, setClave] = useState("");
  const [claveError, setClaveError] = useState(false);

  // ── Una sola petición: traer TODO y cachear ──
  const fetchAll = async () => {
    setLoading(true);
    const q = query(colRef, orderBy("createdAt"));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    saveCache(data);
    setAllUsers(data);
    setLoading(false);
  };

  // Al montar: leer cache o fetch
  useEffect(() => {
    const cached = loadCache();
    if (cached) {
      setAllUsers(cached);
      console.log("cahce cargada");
    } else {
      fetchAll();
    }
  }, []);

  // Forzar recarga desde Firebase
  const handleRefresh = () => {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_TS_KEY);
    setPage(1);
    fetchAll();
  };

  // ── Counts calculados en memoria ──
  const totalCount = allUsers.length;
  const premiumCount = allUsers.filter(
    (u) => u.cart?.nombre === "Plan Premium",
  ).length;
  const starterCount = allUsers.filter(
    (u) => u.cart?.nombre === "Plan Starter",
  ).length;
  const totalIngresos = premiumCount * 208 + starterCount * 170;

  // ── Usuarios vencidos ──
  const vencidosCount = allUsers.filter((u) => {
    if (!u.activatedAt?.seconds) return false;
    const exp = new Date(u.activatedAt.seconds * 1000);
    exp.setMonth(exp.getMonth() + 1);
    return exp <= new Date();
  }).length;

  // ── Filtrado local + búsqueda ──
  const filtered = useMemo(() => {
    let list = allUsers;
    if (filtro === "premium")
      list = list.filter((u) => u.cart?.nombre === "Plan Premium");
    else if (filtro === "starter")
      list = list.filter((u) => u.cart?.nombre === "Plan Starter");

    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      list = list.filter(
        (u) =>
          (u.datapayphone?.email || "").toLowerCase().includes(q) ||
          (u.datapayphone?.optionalParameter2 || "")
            .toLowerCase()
            .includes(q) ||
          (u.datapayphone?.optionalParameter1 || "").includes(q) ||
          (u.datapayphone?.phoneNumber || "").includes(q),
      );
    }
    return list;
  }, [allUsers, filtro, busqueda]);

  // ── Paginación local ──
  const usuarios = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = usuarios.length < filtered.length;

  // Reset página al cambiar filtro
  useEffect(() => {
    setPage(1);
  }, [filtro]);

  // ── Helpers ──
  const formatDate = (ts) => {
    if (!ts?.seconds) return "—";
    return new Date(ts.seconds * 1000).toLocaleDateString("es-EC", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };
  console.log(allUsers);

  const getProximoPago = (ts) => {
    if (!ts?.seconds) return "—";
    const activated = new Date(ts.seconds * 1000);
    activated.setMonth(activated.getMonth() + 1);
    const now = new Date();
    const vencido = activated <= now;
    return {
      fecha: activated.toLocaleDateString("es-EC", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
      vencido,
    };
  };

  const getPlan = (cart) => cart?.nombre || "Sin plan";

  const getAmount = (cart) => {
    if (cart?.nombre === "Plan Premium") return "$208";
    if (cart?.nombre === "Plan Starter") return "$170";
    return "—";
  };

  const getEmail = (u) =>
    u.datapayphone?.email || u.datapayphone?.optionalParameter2 || "—";

  const getPhone = (u) =>
    u.datapayphone?.optionalParameter1 || u.datapayphone?.phoneNumber || "—";

  const handleClaveSubmit = () => {
    if (clave === "Lenaluchies1") {
      setAutenticado(true);
      setClaveError(false);
    } else {
      setClaveError(true);
    }
  };

  /*eliomartos*/

  const handleRefresh2 = () => {
    localStorage.clear(); // 🔥 borra todo
    setPage(1);
    fetchAll();
  };

  return (
    <div className="dashboard">
      {!autenticado && (
        <div className="modal-overlay">
          <div className="modal-clave">
            <h2>🔒 Acceso restringido</h2>
            <p>Ingresa la clave para continuar</p>
            <input
              type="password"
              className="input-clave"
              placeholder="Clave..."
              value={clave}
              onChange={(e) => {
                setClave(e.target.value);
                setClaveError(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleClaveSubmit()}
            />
            {claveError && (
              <span className="clave-error">Clave incorrecta</span>
            )}
            <button className="btn-clave" onClick={handleClaveSubmit}>
              Ingresar
            </button>
            {onClose && (
              <button className="btn-cerrar" onClick={onClose}>
                Cerrar
              </button>
            )}
          </div>
        </div>
      )}
      <header className="dashboard-header">
        <div className="header-row">
          <div>
            <h1>📊 Panel de Control</h1>
            <p className="subtitle">Usuarios Activos — Rita</p>
          </div>
          <button
            className="btn-refresh"
            onClick={handleRefresh}
            disabled={loading}
          >
            {loading ? "⏳ Actualizando..." : "↻ Actualizar datos"}
          </button>

          <button
            className="btn-refresh"
            onClick={handleRefresh2}
            disabled={loading}
          >
            {loading ? "⏳ Actualizando..." : "↻ Borrar todo"}
          </button>
        </div>
      </header>

      {/* ── CARDS ── */}
      <div className="cards">
        <div
          className={`card card-total ${filtro === "todos" ? "active" : ""}`}
          onClick={() => setFiltro("todos")}
        >
          <div className="card-icon">👥</div>
          <div className="card-info">
            <span className="card-label">Total Usuarios</span>
            <span className="card-value">{totalCount}</span>
          </div>
        </div>
        <div
          className={`card card-premium ${filtro === "premium" ? "active" : ""}`}
          onClick={() => setFiltro("premium")}
        >
          <div className="card-icon">⭐</div>
          <div className="card-info">
            <span className="card-label">Premium</span>
            <span className="card-value">{premiumCount}</span>
          </div>
        </div>
        <div
          className={`card card-starter ${filtro === "starter" ? "active" : ""}`}
          onClick={() => setFiltro("starter")}
        >
          <div className="card-icon">🚀</div>
          <div className="card-info">
            <span className="card-label">Starter</span>
            <span className="card-value">{starterCount}</span>
          </div>
        </div>

        <div className="card card-expired">
          <div className="card-icon">⚠️</div>
          <div className="card-info">
            <span className="card-label">Vencidos</span>
            <span className="card-value">{vencidosCount}</span>
          </div>
        </div>
      </div>

      {/* ── BARRA BÚSQUEDA + INFO ── */}
      <div className="toolbar">
        <input
          className="search-input"
          type="text"
          placeholder="🔍 Buscar por email o teléfono..."
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value);
            setPage(1);
          }}
        />
        <span className="result-count">
          {filtered.length} resultado{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── TABLA ── */}
      <div className="table-wrapper">
        {usuarios.length === 0 && !loading ? (
          <div className="empty-state">No se encontraron usuarios</div>
        ) : (
          <table className="user-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Email</th>
                <th>Teléfono</th>
                <th>Plan</th>
                <th>Monto</th>
                <th>Pago</th>
                <th>Próximo Pago</th>
                <th>Registro</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u, i) => {
                const pp = getProximoPago(u.activatedAt);
                return (
                  <tr key={u.id}>
                    <td className="td-num">{i + 1}</td>
                    <td className="td-email">{getEmail(u)}</td>
                    <td>{getPhone(u)}</td>
                    <td>
                      <span
                        className={`badge ${getPlan(u.cart) === "Plan Premium" ? "badge-premium" : "badge-starter"}`}
                      >
                        {getPlan(u.cart)}
                      </span>
                    </td>
                    <td className="td-amount">{getAmount(u.cart)}</td>
                    <td>
                      <span
                        className={`status ${u.transactionStatus === "Approved" ? "status-ok" : "status-pending"}`}
                      >
                        {u.transactionStatus === "Approved"
                          ? "Aprobado"
                          : u.transactionStatus || "—"}
                      </span>
                    </td>
                    <td>
                      {pp === "—" ? (
                        "—"
                      ) : (
                        <span
                          className={`próximo-pago ${pp.vencido ? "vencido" : "vigente"}`}
                        >
                          {pp.fecha}
                          {pp.vencido && (
                            <span className="vencido-tag">Vencido</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="td-date">{formatDate(u.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {hasMore && (
        <button className="btn-more" onClick={() => setPage((p) => p + 1)}>
          Cargar más ({filtered.length - usuarios.length} restantes)
        </button>
      )}
    </div>
  );
}

export default Dashboard;
