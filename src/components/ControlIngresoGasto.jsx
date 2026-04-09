import { useState, useEffect, useMemo } from "react";
import "./ControlIngresoGasto.css";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firbase/Firebase";

const CACHE_KEY = "rita_usuarios_cache";
const PRECIO_PREMIUM = 208;
const PRECIO_STARTER = 170;

function ControlIngresoGasto({ onClose }) {
  const [claveIngresada, setClaveIngresada] = useState("");
  const [acceso, setAcceso] = useState(false);
  const [claveError, setClaveError] = useState(false);
  const [usuarios, setUsuarios] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [filtro, setFiltro] = useState("mes");
  const [fechaFiltro, setFechaFiltro] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [mesFiltro, setMesFiltro] = useState(
    new Date().toISOString().slice(0, 7),
  );
  const [fechaDesde, setFechaDesde] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [fechaHasta, setFechaHasta] = useState(
    new Date().toISOString().slice(0, 10),
  );

  // Cargar usuarios (ingresos) desde cache o Firebase
  useEffect(() => {
    const cargarUsuarios = async () => {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          setUsuarios(JSON.parse(cached));
          return;
        }
      } catch {
        // ignorar
      }
      try {
        const snap = await getDocs(collection(db, "UsuariosActivos"));
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setUsuarios(data);
      } catch (err) {
        console.error("Error cargando usuarios:", err);
      }
    };
    cargarUsuarios();
  }, []);

  // Cargar gastos desde localStorage o Firebase
  useEffect(() => {
    const cargarGastos = async () => {
      try {
        const local = localStorage.getItem("historial_gastos");
        if (local) {
          const parsed = JSON.parse(local);
          if (parsed.length > 0) {
            setGastos(parsed);
            return;
          }
        }
      } catch {
        // ignorar
      }
      try {
        const snap = await getDocs(collection(db, "gastos"));
        const lista = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            fecha: data.fecha?.toDate
              ? data.fecha.toDate().toISOString()
              : data.fecha,
          };
        });
        setGastos(lista);
        localStorage.setItem("historial_gastos", JSON.stringify(lista));
      } catch (err) {
        console.error("Error cargando gastos:", err);
      }
    };
    cargarGastos();
  }, []);

  // Filtrar usuarios (ingresos) por fecha de activación
  const usuariosFiltrados = useMemo(() => {
    return usuarios.filter((u) => {
      if (!u.activatedAt?.seconds) return false;
      const fecha = new Date(u.activatedAt.seconds * 1000).toISOString();
      if (filtro === "dia") return fecha.slice(0, 10) === fechaFiltro;
      if (filtro === "rango") {
        const d = fecha.slice(0, 10);
        return d >= fechaDesde && d <= fechaHasta;
      }
      return fecha.slice(0, 7) === mesFiltro;
    });
  }, [usuarios, filtro, fechaFiltro, mesFiltro, fechaDesde, fechaHasta]);

  // Filtrar gastos por fecha
  const gastosFiltrados = useMemo(() => {
    return gastos.filter((g) => {
      if (!g.fecha) return false;
      const fechaStr =
        typeof g.fecha === "string" ? g.fecha : new Date(g.fecha).toISOString();
      if (filtro === "dia") return fechaStr.slice(0, 10) === fechaFiltro;
      if (filtro === "rango") {
        const d = fechaStr.slice(0, 10);
        return d >= fechaDesde && d <= fechaHasta;
      }
      return fechaStr.slice(0, 7) === mesFiltro;
    });
  }, [gastos, filtro, fechaFiltro, mesFiltro, fechaDesde, fechaHasta]);

  // Cálculos
  const premiumFiltrados = usuariosFiltrados.filter(
    (u) => u.cart?.nombre === "Plan Premium",
  ).length;
  const starterFiltrados = usuariosFiltrados.filter(
    (u) => u.cart?.nombre === "Plan Starter",
  ).length;
  const totalIngresos =
    premiumFiltrados * PRECIO_PREMIUM + starterFiltrados * PRECIO_STARTER;
  const totalGastos = gastosFiltrados.reduce(
    (acc, g) => acc + (g.costo || 0),
    0,
  );
  const balance = totalIngresos - totalGastos;

  const barTotal = totalIngresos + totalGastos || 1;
  const pctIngreso = (totalIngresos / barTotal) * 100;
  const pctGasto = (totalGastos / barTotal) * 100;

  const periodoLabel =
    filtro === "dia"
      ? new Date(fechaFiltro + "T12:00:00").toLocaleDateString("es", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        })
      : filtro === "rango"
        ? `${new Date(fechaDesde + "T12:00:00").toLocaleDateString("es", { day: "2-digit", month: "short" })} — ${new Date(fechaHasta + "T12:00:00").toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" })}`
        : new Date(mesFiltro + "-15").toLocaleDateString("es", {
            month: "long",
            year: "numeric",
          });

  const verificarClave = () => {
    if (claveIngresada === "Lenaluchies1") {
      setAcceso(true);
      setClaveError(false);
    } else {
      setClaveError(true);
    }
  };

  if (!acceso) {
    return (
      <div className="clave-modal-overlay">
        <div className="clave-modal">
          <div className="clave-modal-icon">🔒</div>
          <h2>Acceso restringido</h2>
          <p>Ingresa la clave para continuar</p>
          <input
            type="password"
            className={`clave-input ${claveError ? "clave-input-error" : ""}`}
            placeholder="Clave de acceso"
            value={claveIngresada}
            onChange={(e) => {
              setClaveIngresada(e.target.value);
              setClaveError(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && verificarClave()}
          />
          {claveError && (
            <span className="clave-error-msg">Clave incorrecta</span>
          )}
          <div className="clave-modal-buttons">
            <button className="clave-btn-back" onClick={onClose}>
              ← Volver
            </button>
            <button className="clave-btn-enter" onClick={verificarClave}>
              Ingresar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="control-ig">
      <header className="control-ig-header">
        <div className="header-top-row">
          <button className="btn-volver-menu" onClick={onClose}>
            ← Menú
          </button>
        </div>
        <h1>💰 Control de Ingreso y Gasto</h1>
        <p className="subtitle">Resumen financiero — {periodoLabel}</p>
      </header>

      {/* ── Filtros ── */}
      <div className="control-ig-filtros">
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="dia">Por día</option>
          <option value="mes">Por mes</option>
          <option value="rango">Período personalizado</option>
        </select>
        {filtro === "dia" ? (
          <input
            type="date"
            value={fechaFiltro}
            onChange={(e) => setFechaFiltro(e.target.value)}
          />
        ) : filtro === "rango" ? (
          <>
            <label className="filtro-range-label">Desde</label>
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
            />
            <label className="filtro-range-label">Hasta</label>
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
            />
          </>
        ) : (
          <input
            type="month"
            value={mesFiltro}
            onChange={(e) => setMesFiltro(e.target.value)}
          />
        )}
      </div>

      {/* ── Resumen ── */}
      <div className="control-ig-resumen">
        <div className="resumen-card ingreso">
          <div className="card-icon">📈</div>
          <div className="card-info">
            <span className="card-label">Ingresos</span>
            <span className="card-value">${totalIngresos.toFixed(2)}</span>
          </div>
        </div>
        <div className="resumen-card gasto">
          <div className="card-icon">📉</div>
          <div className="card-info">
            <span className="card-label">Gastos</span>
            <span className="card-value">${totalGastos.toFixed(2)}</span>
          </div>
        </div>
        <div
          className={`resumen-card balance ${balance >= 0 ? "balance-positivo" : "balance-negativo"}`}
        >
          <div className="card-icon">{balance >= 0 ? "✅" : "⚠️"}</div>
          <div className="card-info">
            <span className="card-label">Balance</span>
            <span className="card-value">
              {balance >= 0 ? "+" : ""}${balance.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Barra visual ── */}
      <div className="control-ig-bar-container">
        <h3>Proporción ingreso vs gasto</h3>
        <div className="bar-wrapper">
          <div className="bar-ingreso" style={{ width: `${pctIngreso}%` }} />
          <div className="bar-gasto" style={{ width: `${pctGasto}%` }} />
        </div>
        <div className="bar-labels">
          <span className="label-ingreso">
            Ingresos {pctIngreso.toFixed(0)}%
          </span>
          <span className="label-gasto">Gastos {pctGasto.toFixed(0)}%</span>
        </div>
      </div>

      {/* ── Detalle ── */}
      <div className="control-ig-detalle">
        {/* Ingresos */}
        <div className="detalle-card">
          <h3>
            <span>📈</span> Detalle de Ingresos
          </h3>
          {usuariosFiltrados.length === 0 ? (
            <div className="detalle-empty">
              <div className="empty-icon">📭</div>
              <p>Sin ingresos en este período</p>
            </div>
          ) : (
            <table className="ig-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Cliente</th>
                  <th>Plan</th>
                  <th>Monto</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {usuariosFiltrados.map((u, i) => {
                  const plan = u.cart?.nombre || "—";
                  const monto =
                    plan === "Plan Premium"
                      ? PRECIO_PREMIUM
                      : plan === "Plan Starter"
                        ? PRECIO_STARTER
                        : 0;
                  const fecha = u.activatedAt?.seconds
                    ? new Date(u.activatedAt.seconds * 1000).toLocaleDateString(
                        "es",
                        {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        },
                      )
                    : "—";
                  return (
                    <tr key={u.id}>
                      <td data-label="#">{i + 1}</td>
                      <td data-label="Cliente" className="td-name">
                        {u.datapayphone?.optionalParameter4 ||
                          u.datapayphone?.email ||
                          "Sin nombre"}
                      </td>
                      <td data-label="Plan">
                        <span
                          className={`plan-badge ${plan === "Plan Premium" ? "premium" : "starter"}`}
                        >
                          {plan.replace("Plan ", "")}
                        </span>
                      </td>
                      <td data-label="Monto" className="td-ingreso">
                        ${monto.toFixed(2)}
                      </td>
                      <td data-label="Fecha" className="td-muted">
                        {fecha}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="3">
                    {premiumFiltrados} Premium · {starterFiltrados} Starter
                  </td>
                  <td colSpan="2" className="td-ingreso">
                    ${totalIngresos.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Gastos */}
        <div className="detalle-card">
          <h3>
            <span>📉</span> Detalle de Gastos
          </h3>
          {gastosFiltrados.length === 0 ? (
            <div className="detalle-empty">
              <div className="empty-icon">📭</div>
              <p>Sin gastos en este período</p>
            </div>
          ) : (
            <table className="ig-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ingrediente</th>
                  <th>Cantidad</th>
                  <th>Costo</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {gastosFiltrados
                  .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
                  .map((g, i) => (
                    <tr key={g.id || i}>
                      <td data-label="#">{i + 1}</td>
                      <td data-label="Ingrediente" className="td-name">
                        {g.ingrediente}
                      </td>
                      <td data-label="Cantidad" className="td-muted">
                        {g.cantidad} {g.unidad}
                      </td>
                      <td data-label="Costo" className="td-gasto">
                        ${(g.costo || 0).toFixed(2)}
                      </td>
                      <td data-label="Fecha" className="td-muted">
                        {new Date(g.fecha).toLocaleDateString("es", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="3">
                    {gastosFiltrados.length} compra
                    {gastosFiltrados.length !== 1 ? "s" : ""}
                  </td>
                  <td colSpan="2" className="td-gasto">
                    ${totalGastos.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default ControlIngresoGasto;
