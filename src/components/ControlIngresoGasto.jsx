import { useState, useEffect, useMemo } from "react";
import "./ControlIngresoGasto.css";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firbase/Firebase";

const PRECIO_PREMIUM = 208;
const PRECIO_STARTER = 170;

function ControlIngresoGasto({ onClose }) {
  const [claveIngresada, setClaveIngresada] = useState("");
  const [acceso, setAcceso] = useState(false);
  const [claveError, setClaveError] = useState(false);
  const [usuarios, setUsuarios] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [bodega, setBodega] = useState([]);
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
  const [usuarioSeleccionado, setUsuarioSeleccionado] = useState(null);

  // Cargar usuarios (ingresos) desde Firebase
  useEffect(() => {
    const cargarUsuarios = async () => {
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
  console.log(usuarios, "user");
  // Cargar gastos desde Firebase
  useEffect(() => {
    const cargarGastos = async () => {
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
      } catch (err) {
        console.error("Error cargando gastos:", err);
      }
    };
    cargarGastos();
  }, []);

  // Cargar bodega desde Firebase
  useEffect(() => {
    const cargarBodega = async () => {
      try {
        const { doc, getDoc } = await import("firebase/firestore");
        const snap = await getDoc(doc(db, "bodega", "mi_bodega"));
        if (snap.exists()) {
          const data = snap.data();
          setBodega(data.ingredientes || []);
        }
      } catch (err) {
        console.error("Error cargando bodega:", err);
      }
    };
    cargarBodega();
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
  // Costo de menú por usuario
  const parseQty = (str) => {
    if (!str) return { qty: 0, unit: "" };
    const match = String(str).match(/^([\d.]+)\s*([a-zA-Z]*)/);
    return match
      ? { qty: parseFloat(match[1]) || 0, unit: (match[2] || "").toLowerCase() }
      : { qty: 0, unit: "" };
  };

  const COMIDAS = ["desayuno", "almuerzo", "cena", "snack1", "snack2"];
  const DIAS = ["dia1", "dia2", "dia3", "dia4", "dia5"];

  const costosPorUsuario = useMemo(() => {
    return usuariosFiltrados.map((u) => {
      let costoTotal = 0;
      const detalle = {};
      const menucreado = u.menu?.menucreado;
      if (menucreado) {
        DIAS.forEach((dia) => {
          const diaData = menucreado[dia];
          if (!diaData) return;
          COMIDAS.forEach((comida) => {
            const comidaData = diaData[comida];
            if (!comidaData?.ingredientes) return;
            Object.entries(comidaData.ingredientes).forEach(
              ([nombre, cantStr]) => {
                const { qty, unit } = parseQty(cantStr);
                if (!qty) return;
                const ingredienteBodega = bodega.find(
                  (b) => b.nombre.toLowerCase() === nombre.toLowerCase(),
                );
                if (!ingredienteBodega) return;
                const costo = qty * (ingredienteBodega.costoPorUnidad || 0);
                costoTotal += costo;
                detalle[nombre] = {
                  qty: (detalle[nombre]?.qty || 0) + qty,
                  unit,
                  costoPorUnidad: ingredienteBodega.costoPorUnidad || 0,
                  costoTotal: (detalle[nombre]?.costoTotal || 0) + costo,
                };
              },
            );
          });
        });
      }
      const planPrecio =
        u.cart?.nombre === "Plan Premium"
          ? PRECIO_PREMIUM
          : u.cart?.nombre === "Plan Starter"
            ? PRECIO_STARTER
            : 0;
      return {
        usuario: u,
        costoMenu: costoTotal,
        detalle,
        ganancia: planPrecio - costoTotal,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuariosFiltrados, bodega]);

  const totalCostosMenus = costosPorUsuario.reduce(
    (acc, { costoMenu }) => acc + costoMenu,
    0,
  );
  const totalGastoReal = totalGastos + totalCostosMenus;
  const balanceReal = totalIngresos - totalGastoReal;
  const barTotal = totalIngresos + totalGastoReal || 1;
  const pctIngreso = (totalIngresos / barTotal) * 100;
  const pctGastoCompras = (totalGastos / barTotal) * 100;
  const pctGastoMenus = (totalCostosMenus / barTotal) * 100;

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
      <div className="control-ig-resumen control-ig-resumen-4">
        <div className="resumen-card ingreso">
          <div className="card-icon">📈</div>
          <div className="card-info">
            <span className="card-label">Ingresos</span>
            <span className="card-value">${totalIngresos.toFixed(2)}</span>
          </div>
        </div>
        <div className="resumen-card gasto">
          <div className="card-icon">🛒</div>
          <div className="card-info">
            <span className="card-label">Compras bodega</span>
            <span className="card-value">${totalGastos.toFixed(2)}</span>
          </div>
        </div>
        <div className="resumen-card menu-cost">
          <div className="card-icon">🍽️</div>
          <div className="card-info">
            <span className="card-label">Costos menús</span>
            <span className="card-value">${totalCostosMenus.toFixed(2)}</span>
          </div>
        </div>
        <div
          className={`resumen-card balance ${balanceReal >= 0 ? "balance-positivo" : "balance-negativo"}`}
        >
          <div className="card-icon">{balanceReal >= 0 ? "✅" : "⚠️"}</div>
          <div className="card-info">
            <span className="card-label">Balance neto</span>
            <span className="card-value">
              {balanceReal >= 0 ? "+" : ""}${balanceReal.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Barra visual ── */}
      <div className="control-ig-bar-container">
        <h3>Distribución de ingresos y egresos</h3>
        <div className="bar-wrapper">
          <div className="bar-ingreso" style={{ width: `${pctIngreso}%` }} />
          <div
            className="bar-gasto-compras"
            style={{ width: `${pctGastoCompras}%` }}
          />
          <div
            className="bar-gasto-menus"
            style={{ width: `${pctGastoMenus}%` }}
          />
        </div>
        <div className="bar-labels">
          <span className="label-ingreso">
            Ingresos {pctIngreso.toFixed(0)}%
          </span>
          <span className="label-gasto-compras">
            Compras {pctGastoCompras.toFixed(0)}%
          </span>
          <span className="label-gasto-menus">
            Menús {pctGastoMenus.toFixed(0)}%
          </span>
        </div>
      </div>

      {/* ── Métricas de salud ── */}
      <div className="control-ig-metricas">
        <div className="metrica-card">
          <div className="metrica-icon">📊</div>
          <div className="metrica-info">
            <span className="metrica-label">Margen bruto</span>
            <span
              className={`metrica-valor ${
                totalIngresos > 0 &&
                (totalIngresos - totalCostosMenus) / totalIngresos >= 0.5
                  ? "metrica-verde"
                  : "metrica-rojo"
              }`}
            >
              {totalIngresos > 0
                ? (
                    ((totalIngresos - totalCostosMenus) / totalIngresos) *
                    100
                  ).toFixed(1)
                : "0"}
              %
            </span>
          </div>
        </div>
        <div className="metrica-card">
          <div className="metrica-icon">🍽️</div>
          <div className="metrica-info">
            <span className="metrica-label">Costo prom. menú</span>
            <span className="metrica-valor metrica-rojo">
              $
              {costosPorUsuario.length > 0
                ? (totalCostosMenus / costosPorUsuario.length).toFixed(2)
                : "0.00"}
            </span>
          </div>
        </div>
        <div className="metrica-card">
          <div className="metrica-icon">💸</div>
          <div className="metrica-info">
            <span className="metrica-label">Total egresos</span>
            <span className="metrica-valor metrica-rojo">
              ${totalGastoReal.toFixed(2)}
            </span>
          </div>
        </div>
        <div className="metrica-card">
          <div className="metrica-icon">🎯</div>
          <div className="metrica-info">
            <span className="metrica-label">ROI neto</span>
            <span
              className={`metrica-valor ${
                balanceReal >= 0 ? "metrica-verde" : "metrica-rojo"
              }`}
            >
              {totalGastoReal > 0
                ? ((balanceReal / totalGastoReal) * 100).toFixed(1)
                : "0"}
              %
            </span>
          </div>
        </div>
        <div className="metrica-card">
          <div className="metrica-icon">👥</div>
          <div className="metrica-info">
            <span className="metrica-label">Usuarios período</span>
            <span className="metrica-valor">{usuariosFiltrados.length}</span>
          </div>
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

      {/* ── Costo de menú por usuario ── */}
      <div className="control-ig-detalle">
        <div className="detalle-card" style={{ gridColumn: "1 / -1" }}>
          <h3>
            <span>🍽️</span> Costo de Menú por Usuario
          </h3>
          {costosPorUsuario.length === 0 ? (
            <div className="detalle-empty">
              <div className="empty-icon">📭</div>
              <p>Sin usuarios en este período</p>
            </div>
          ) : (
            <table className="ig-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Cliente</th>
                  <th>Plan</th>
                  <th>Costo Menú</th>
                  <th>Ganancia Neta</th>
                </tr>
              </thead>
              <tbody>
                {costosPorUsuario.map((item, i) => {
                  const { usuario: u, costoMenu, ganancia } = item;
                  const plan = u.cart?.nombre || "—";
                  return (
                    <tr
                      key={u.id}
                      className="tr-clickable"
                      onClick={() => setUsuarioSeleccionado(item)}
                      title="Ver desglose de ingredientes"
                    >
                      <td data-label="#">{i + 1}</td>
                      <td data-label="Cliente" className="td-name">
                        {u.datapayphone?.optionalParameter4 ||
                          u.datapayphone?.email ||
                          "Sin nombre"}
                        <span className="td-click-hint">→</span>
                      </td>
                      <td data-label="Plan">
                        <span
                          className={`plan-badge ${
                            plan === "Plan Premium" ? "premium" : "starter"
                          }`}
                        >
                          {plan.replace("Plan ", "")}
                        </span>
                      </td>
                      <td data-label="Costo Menú" className="td-gasto">
                        ${costoMenu.toFixed(2)}
                      </td>
                      <td
                        data-label="Ganancia Neta"
                        className={ganancia >= 0 ? "td-ingreso" : "td-gasto"}
                      >
                        {ganancia >= 0 ? "+" : ""}${ganancia.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="3">
                    {costosPorUsuario.length} usuario
                    {costosPorUsuario.length !== 1 ? "s" : ""}
                  </td>
                  <td className="td-gasto">${totalCostosMenus.toFixed(2)}</td>
                  <td
                    className={
                      costosPorUsuario.reduce(
                        (a, { ganancia }) => a + ganancia,
                        0,
                      ) >= 0
                        ? "td-ingreso"
                        : "td-gasto"
                    }
                  >
                    {costosPorUsuario.reduce(
                      (a, { ganancia }) => a + ganancia,
                      0,
                    ) >= 0
                      ? "+"
                      : ""}
                    $
                    {costosPorUsuario
                      .reduce((a, { ganancia }) => a + ganancia, 0)
                      .toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {/* ── Modal desglose usuario ── */}
      {usuarioSeleccionado && (
        <div
          className="usuario-modal-overlay"
          onClick={() => setUsuarioSeleccionado(null)}
        >
          <div className="usuario-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="usuario-modal-close"
              onClick={() => setUsuarioSeleccionado(null)}
            >
              ✕
            </button>
            <div className="usuario-modal-header">
              <p className="usuario-modal-name">
                {usuarioSeleccionado.usuario.datapayphone?.optionalParameter4 ||
                  usuarioSeleccionado.usuario.datapayphone?.email ||
                  "Sin nombre"}
              </p>
              <span
                className={`plan-badge ${
                  usuarioSeleccionado.usuario.cart?.nombre === "Plan Premium"
                    ? "premium"
                    : "starter"
                }`}
              >
                {(usuarioSeleccionado.usuario.cart?.nombre || "—").replace(
                  "Plan ",
                  "",
                )}
              </span>
            </div>

            <div className="usuario-modal-totales">
              <div className="modal-total-item">
                <span>Ingreso plan</span>
                <span className="td-ingreso">
                  $
                  {(usuarioSeleccionado.usuario.cart?.nombre === "Plan Premium"
                    ? PRECIO_PREMIUM
                    : PRECIO_STARTER
                  ).toFixed(2)}
                </span>
              </div>
              <div className="modal-total-item">
                <span>Costo menú</span>
                <span className="td-gasto">
                  ${usuarioSeleccionado.costoMenu.toFixed(2)}
                </span>
              </div>
              <div className="modal-total-item modal-balance">
                <span>Ganancia neta</span>
                <span
                  className={
                    usuarioSeleccionado.ganancia >= 0
                      ? "td-ingreso"
                      : "td-gasto"
                  }
                >
                  {usuarioSeleccionado.ganancia >= 0 ? "+" : ""}$
                  {usuarioSeleccionado.ganancia.toFixed(2)}
                </span>
              </div>
            </div>

            <h4 className="usuario-modal-desglose-title">
              🧾 Desglose de ingredientes
            </h4>
            {Object.keys(usuarioSeleccionado.detalle).length === 0 ? (
              <div className="detalle-empty">
                <div className="empty-icon">📭</div>
                <p>Sin ingredientes en bodega para este menú</p>
              </div>
            ) : (
              <table className="ig-table usuario-modal-table">
                <thead>
                  <tr>
                    <th>Ingrediente</th>
                    <th>Cantidad</th>
                    <th>$/unidad</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(usuarioSeleccionado.detalle)
                    .sort((a, b) => b[1].costoTotal - a[1].costoTotal)
                    .map(([nombre, info]) => (
                      <tr key={nombre}>
                        <td data-label="Ingrediente" className="td-name">
                          {nombre}
                        </td>
                        <td data-label="Cantidad" className="td-muted">
                          {info.qty % 1 === 0 ? info.qty : info.qty.toFixed(1)}
                          {info.unit}
                        </td>
                        <td data-label="$/unidad" className="td-muted">
                          ${info.costoPorUnidad.toFixed(3)}
                        </td>
                        <td data-label="Total" className="td-gasto">
                          ${info.costoTotal.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="3">
                      {Object.keys(usuarioSeleccionado.detalle).length}{" "}
                      ingrediente
                      {Object.keys(usuarioSeleccionado.detalle).length !== 1
                        ? "s"
                        : ""}
                    </td>
                    <td className="td-gasto">
                      ${usuarioSeleccionado.costoMenu.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ControlIngresoGasto;
