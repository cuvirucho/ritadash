import { useEffect, useMemo, useState } from "react";
import "./ControlNegocio.css";
import {
  PLANES_ORDEN,
  MODALIDADES_ORDEN,
  SEMANAS_POR_MES,
} from "../services/planes";
import {
  useUsuarios,
  useGastos,
  useBodega,
  formatearFecha,
  cobrosEnPeriodo,
  semanasMenuEnPeriodo,
} from "../services/usuarios";
import { calcularCostoMenu } from "../services/costos";

const CLAVE_ACCESO = "Lenaluchies1";
const PAGE_SIZE = 15;
const MS_DIA = 1000 * 60 * 60 * 24;

const hoyISO = () => new Date().toISOString().slice(0, 10);
const dinero = (n) => `$${(n || 0).toFixed(2)}`;

// El período elegido, resuelto a un rango [desde, hasta] en milisegundos.
// Todo el bloque financiero trabaja con este rango.
function rangoDe({ modo, dia, mes, desde, hasta }) {
  if (modo === "dia") {
    const d = new Date(dia + "T00:00:00");
    return [d.getTime(), d.getTime() + MS_DIA - 1];
  }
  if (modo === "rango") {
    return [
      new Date(desde + "T00:00:00").getTime(),
      new Date(hasta + "T00:00:00").getTime() + MS_DIA - 1,
    ];
  }
  const [y, m] = mes.split("-").map(Number);
  return [
    new Date(y, m - 1, 1).getTime(),
    new Date(y, m, 1).getTime() - 1, // último ms del mes
  ];
}

const enRango = (ms, [desde, hasta]) => !!ms && ms >= desde && ms <= hasta;

function ControlNegocio({ onClose }) {
  // ── Acceso ──
  const [clave, setClave] = useState("");
  const [acceso, setAcceso] = useState(false);
  const [claveError, setClaveError] = useState(false);

  // ── Datos ──
  const { usuarios, loading, ultimaActualizacion, refrescar } = useUsuarios();
  const gastos = useGastos();
  const bodega = useBodega();

  // ── Filtro de período ──
  const [modo, setModo] = useState("mes");
  const [dia, setDia] = useState(hoyISO());
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7));
  const [desde, setDesde] = useState(hoyISO());
  const [hasta, setHasta] = useState(hoyISO());
  const rango = useMemo(
    () => rangoDe({ modo, dia, mes, desde, hasta }),
    [modo, dia, mes, desde, hasta],
  );

  // ── Filtros de la tabla de usuarios ──
  const [filtroPlan, setFiltroPlan] = useState("todos");
  const [filtroModalidad, setFiltroModalidad] = useState(null);
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  const [detalle, setDetalle] = useState(null);

  // ── Costo semanal del menú de cada usuario (una sola pasada) ──
  const costoSemanalPorUsuario = useMemo(() => {
    const mapa = new Map();
    usuarios.forEach((u) => {
      if (!u.tieneMenu) return;
      mapa.set(u.id, calcularCostoMenu(u.menuCreado, bodega).costoSemanal);
    });
    return mapa;
  }, [usuarios, bodega]);

  const costoSemanalDe = (u) => costoSemanalPorUsuario.get(u.id) || 0;

  // ══════════════ A · Resumen global (foto de hoy, base mensual) ══════════════
  const resumen = useMemo(() => {
    const porPlan = {};
    const porModalidad = {};
    let pagados = 0;
    let mrr = 0;
    let costoMensualMenus = 0;

    usuarios.forEach((u) => {
      const k = u.plan.key;
      if (!porPlan[k]) porPlan[k] = { plan: u.plan, cantidad: 0, mrr: 0 };
      porPlan[k].cantidad += 1;
      porPlan[k].mrr += u.ingresoMensual;

      if (u.esPagado) {
        pagados += 1;
        mrr += u.ingresoMensual;

        const m = u.modalidad.key;
        if (!porModalidad[m])
          porModalidad[m] = {
            modalidad: u.modalidad,
            cantidad: 0,
            porCiclo: 0,
            mrr: 0,
          };
        porModalidad[m].cantidad += 1;
        porModalidad[m].porCiclo += u.precioCiclo;
        porModalidad[m].mrr += u.ingresoMensual;
      }
      costoMensualMenus += costoSemanalDe(u) * SEMANAS_POR_MES;
    });

    const total = usuarios.length;
    const filas = [
      ...PLANES_ORDEN.map(
        (p) => porPlan[p.key] || { plan: p, cantidad: 0, mrr: 0 },
      ),
      ...Object.values(porPlan).filter((f) => !f.plan.conocido),
    ];

    // Cobros que caen en los próximos 7 días: lo accionable para cobrar
    const ahora = Date.now();
    const proximos = usuarios.filter(
      (u) =>
        u.proximoCobro &&
        u.proximoCobro >= ahora &&
        u.proximoCobro <= ahora + 7 * MS_DIA,
    );

    return {
      total,
      pagados,
      mrr,
      costoMensualMenus,
      filas,
      modalidades: MODALIDADES_ORDEN.map(
        (m) =>
          porModalidad[m.key] || {
            modalidad: m,
            cantidad: 0,
            porCiclo: 0,
            mrr: 0,
          },
      ),
      desconocidos: Object.values(porPlan).filter(
        (f) => !f.plan.conocido && !f.plan.vacio,
      ),
      sinRegistrar: usuarios.filter((u) => u.cobroSinRegistrar),
      proximosCobros: proximos,
      montoProximosCobros: proximos.reduce((a, u) => a + u.precioCiclo, 0),
      conteo: (key) => porPlan[key]?.cantidad || 0,
      conversion: total > 0 ? (pagados / total) * 100 : 0,
      arpu: pagados > 0 ? mrr / pagados : 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarios, costoSemanalPorUsuario]);

  // ══════════════ C · Tabla de usuarios ══════════════
  const usuariosFiltrados = useMemo(() => {
    let lista = usuarios;
    if (filtroPlan !== "todos")
      lista = lista.filter((u) => u.plan.key === filtroPlan);
    if (filtroModalidad)
      lista = lista.filter(
        (u) => u.esPagado && u.modalidad.key === filtroModalidad,
      );
    if (soloPendientes) lista = lista.filter((u) => u.cobroSinRegistrar);

    const q = busqueda.trim().toLowerCase();
    if (q) {
      lista = lista.filter(
        (u) =>
          u.nombre.toLowerCase().includes(q) ||
          u.correo.toLowerCase().includes(q) ||
          u.telefono.toLowerCase().includes(q),
      );
    }
    return lista;
  }, [usuarios, filtroPlan, filtroModalidad, soloPendientes, busqueda]);

  const visibles = usuariosFiltrados.slice(0, pagina * PAGE_SIZE);
  const restantes = usuariosFiltrados.length - visibles.length;

  const limpiarFiltros = () => {
    setFiltroPlan("todos");
    setFiltroModalidad(null);
    setSoloPendientes(false);
    setPagina(1);
  };

  // ══════════════ D · Conversiones del período ══════════════
  const registradosPeriodo = useMemo(
    () => usuarios.filter((u) => enRango(u.fechaRegistro, rango)),
    [usuarios, rango],
  );

  const activadosPeriodo = useMemo(
    () =>
      usuarios.filter((u) => u.esPagado && enRango(u.fechaActivacion, rango)),
    [usuarios, rango],
  );

  const diasPromedioConversion = useMemo(() => {
    const conDato = activadosPeriodo.filter((u) => u.diasParaConvertir !== null);
    if (!conDato.length) return null;
    return conDato.reduce((a, u) => a + u.diasParaConvertir, 0) / conDato.length;
  }, [activadosPeriodo]);

  // ══════════════ E · Ingresos del período: un renglón por COBRO ══════════════
  const cobrosPeriodo = useMemo(() => {
    const lista = [];
    usuarios.forEach((u) => {
      cobrosEnPeriodo(u, rango[0], rango[1]).forEach((c) =>
        lista.push({ usuario: u, ...c, monto: u.precioCiclo }),
      );
    });
    return lista.sort((a, b) => b.fecha - a.fecha);
  }, [usuarios, rango]);

  const totalIngresos = cobrosPeriodo.reduce((a, c) => a + c.monto, 0);

  // ══════════════ Gastos de bodega del período ══════════════
  const gastosPeriodo = useMemo(
    () => gastos.filter((g) => enRango(g.fecha, rango)),
    [gastos, rango],
  );
  const totalCompras = gastosPeriodo.reduce((a, g) => a + (g.costo || 0), 0);

  // ══════════════ G · Costo de menú por usuario ══════════════
  // Vista mensual: así el ingreso y el costo hablan del mismo período.
  const costosMenu = useMemo(() => {
    return usuarios
      .filter((u) => u.tieneMenu)
      .map((u) => {
        const costoSemanal = costoSemanalDe(u);
        const costoMensual = costoSemanal * SEMANAS_POR_MES;
        const semanasPeriodo = semanasMenuEnPeriodo(u, rango[0], rango[1]);
        return {
          usuario: u,
          costoSemanal,
          costoMensual,
          semanasPeriodo,
          costoPeriodo: costoSemanal * semanasPeriodo,
          gananciaMensual: u.ingresoMensual - costoMensual,
          margen:
            u.ingresoMensual > 0
              ? ((u.ingresoMensual - costoMensual) / u.ingresoMensual) * 100
              : null,
        };
      })
      .sort((a, b) => a.gananciaMensual - b.gananciaMensual); // pérdidas primero
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarios, costoSemanalPorUsuario, rango]);

  const totalCostosMenus = costosMenu.reduce((a, c) => a + c.costoPeriodo, 0);
  const totalEgresos = totalCompras + totalCostosMenus;
  const balance = totalIngresos - totalEgresos;

  const barTotal = totalIngresos + totalEgresos || 1;
  const pctIngreso = (totalIngresos / barTotal) * 100;
  const pctCompras = (totalCompras / barTotal) * 100;
  const pctMenus = (totalCostosMenus / barTotal) * 100;

  const margenBruto =
    totalIngresos > 0
      ? ((totalIngresos - totalCostosMenus) / totalIngresos) * 100
      : 0;
  const roi = totalEgresos > 0 ? (balance / totalEgresos) * 100 : 0;

  // Margen mensual estructural: MRR contra el costo mensual de todos los menús
  const margenMensual =
    resumen.mrr > 0
      ? ((resumen.mrr - resumen.costoMensualMenus) / resumen.mrr) * 100
      : 0;

  const periodoLabel =
    modo === "dia"
      ? new Date(dia + "T12:00:00").toLocaleDateString("es", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        })
      : modo === "rango"
        ? `${new Date(desde + "T12:00:00").toLocaleDateString("es", { day: "2-digit", month: "short" })} — ${new Date(hasta + "T12:00:00").toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" })}`
        : new Date(mes + "-15").toLocaleDateString("es", {
            month: "long",
            year: "numeric",
          });

  // "actualizado hace X": se refresca cada minuto en vez de leer el reloj
  // durante el render (el render debe ser puro).
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const haceCuanto = () => {
    if (!ultimaActualizacion) return "";
    const min = Math.floor((ahora - ultimaActualizacion) / 60000);
    if (min < 1) return "recién actualizado";
    if (min < 60) return `actualizado hace ${min} min`;
    return `actualizado hace ${Math.floor(min / 60)} h`;
  };

  const verificarClave = () => {
    if (clave === CLAVE_ACCESO) {
      setAcceso(true);
      setClaveError(false);
    } else {
      setClaveError(true);
    }
  };

  // ══════════════ Gate ══════════════
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
            value={clave}
            onChange={(e) => {
              setClave(e.target.value);
              setClaveError(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && verificarClave()}
          />
          {claveError && (
            <span className="clave-error-msg">Clave incorrecta</span>
          )}
          <div className="clave-modal-buttons">
            {onClose && (
              <button className="clave-btn-back" onClick={onClose}>
                ← Volver
              </button>
            )}
            <button className="clave-btn-enter" onClick={verificarClave}>
              Ingresar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="negocio">
      {/* ══ Header ══ */}
      <header className="negocio-header">
        <div>
          <h1>📊 Control del Negocio</h1>
          <p className="subtitle">
            Usuarios y finanzas — Rita{" "}
            {ultimaActualizacion && (
              <span className="header-stamp">· {haceCuanto()}</span>
            )}
          </p>
        </div>
        <div className="header-actions">
          <button
            className="btn-refresh"
            onClick={refrescar}
            disabled={loading}
          >
            {loading ? "⏳ Actualizando..." : "↻ Actualizar datos"}
          </button>
          {onClose && (
            <button className="btn-volver-menu" onClick={onClose}>
              ← Menú
            </button>
          )}
        </div>
      </header>

      {/* ══════════════ A · Resumen de usuarios ══════════════ */}
      <section className="negocio-seccion">
        <div className="seccion-titulo">
          <h2>👥 Usuarios por plan</h2>
          <span className="seccion-hint">
            Foto de hoy · todo en base mensual ({SEMANAS_POR_MES} semanas ={" "}
            {SEMANAS_POR_MES * 5} días de entrega)
          </span>
        </div>

        <div className="cards">
          <button
            className={`card card-total ${filtroPlan === "todos" && !filtroModalidad && !soloPendientes ? "active" : ""}`}
            onClick={limpiarFiltros}
          >
            <div className="card-icon">👥</div>
            <div className="card-info">
              <span className="card-label">Total usuarios</span>
              <span className="card-value">{resumen.total}</span>
            </div>
          </button>

          {PLANES_ORDEN.map((p) => (
            <button
              key={p.key}
              className={`card card-${p.color} ${filtroPlan === p.key ? "active" : ""}`}
              onClick={() => {
                setFiltroPlan(p.key);
                setFiltroModalidad(null);
                setSoloPendientes(false);
                setPagina(1);
              }}
            >
              <div className="card-icon">{p.icono}</div>
              <div className="card-info">
                <span className="card-label">{p.label}</span>
                <span className="card-value">{resumen.conteo(p.key)}</span>
                <span className="card-sub">
                  {p.precios.semanal > 0
                    ? `${dinero(p.precios.semanal)}/sem · ${dinero(p.precios.mensual)}/mes`
                    : "sin costo"}
                </span>
              </div>
            </button>
          ))}

          <div className="card card-cobros">
            <div className="card-icon">📅</div>
            <div className="card-info">
              <span className="card-label">Cobros próximos 7 días</span>
              <span className="card-value">
                {resumen.proximosCobros.length}
              </span>
              <span className="card-sub">
                {dinero(resumen.montoProximosCobros)} por cobrar
              </span>
            </div>
          </div>

          <div className="card card-income">
            <div className="card-icon">💰</div>
            <div className="card-info">
              <span className="card-label">Ingreso mensual (MRR)</span>
              <span className="card-value">{dinero(resumen.mrr)}</span>
              <span className="card-sub">
                {resumen.pagados} de pago · ARPU {dinero(resumen.arpu)}
              </span>
            </div>
          </div>
        </div>

        {resumen.desconocidos.length > 0 && (
          <div className="aviso-plan">
            ⚠️ Hay planes que no están configurados:{" "}
            {resumen.desconocidos
              .map((f) => `"${f.plan.label}" (${f.cantidad})`)
              .join(", ")}
            . Se cuentan con $0 hasta que se agreguen en{" "}
            <code>src/services/planes.js</code>.
          </div>
        )}
      </section>

      {/* ══════════════ B · Distribución por plan ══════════════ */}
      <section className="negocio-seccion">
        <div className="panel">
          <h3>Distribución de la base de usuarios</h3>

          <div className="bar-wrapper">
            {resumen.filas
              .filter((f) => f.cantidad > 0)
              .map((f) => (
                <div
                  key={f.plan.key}
                  className={`bar-seg bar-${f.plan.color}`}
                  style={{
                    width: `${(f.cantidad / (resumen.total || 1)) * 100}%`,
                  }}
                  title={`${f.plan.label}: ${f.cantidad}`}
                />
              ))}
          </div>
          <div className="bar-labels">
            {resumen.filas
              .filter((f) => f.cantidad > 0)
              .map((f) => (
                <span key={f.plan.key} className={`label-${f.plan.color}`}>
                  {f.plan.label} {f.cantidad} (
                  {((f.cantidad / (resumen.total || 1)) * 100).toFixed(0)}%)
                </span>
              ))}
          </div>

          <table className="ig-table tabla-planes">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Usuarios</th>
                <th>% base</th>
                <th>$ / semana</th>
                <th>$ / mes</th>
                <th>Ingreso mensual</th>
              </tr>
            </thead>
            <tbody>
              {resumen.filas.map((f) => (
                <tr key={f.plan.key}>
                  <td data-label="Plan">
                    <span className={`plan-badge ${f.plan.color}`}>
                      {f.plan.icono} {f.plan.label}
                    </span>
                  </td>
                  <td data-label="Usuarios" className="td-name">
                    {f.cantidad}
                  </td>
                  <td data-label="% base" className="td-muted">
                    {((f.cantidad / (resumen.total || 1)) * 100).toFixed(1)}%
                  </td>
                  <td data-label="$ / semana" className="td-muted">
                    {dinero(f.plan.precios.semanal)}
                  </td>
                  <td data-label="$ / mes" className="td-muted">
                    {dinero(f.plan.precios.mensual)}
                  </td>
                  <td
                    data-label="Ingreso mensual"
                    className={f.mrr > 0 ? "td-ingreso" : "td-muted"}
                  >
                    {dinero(f.mrr)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="5">{resumen.total} usuarios en total</td>
                <td className="td-ingreso">{dinero(resumen.mrr)}</td>
              </tr>
            </tfoot>
          </table>

          <div className="conversion-box">
            <div className="conversion-info">
              <span className="metrica-label">
                Tasa de conversión free → pago
              </span>
              <span className="conversion-detalle">
                {resumen.pagados} de {resumen.total} usuarios pagan
              </span>
            </div>
            <span
              className={`conversion-valor ${resumen.conversion >= 30 ? "metrica-verde" : "metrica-rojo"}`}
            >
              {resumen.conversion.toFixed(1)}%
            </span>
          </div>
        </div>
      </section>

      {/* ══════════════ Modalidad de cobro ══════════════ */}
      <section className="negocio-seccion">
        <div className="seccion-titulo">
          <h2>🧾 Modalidad de cobro</h2>
          <span className="seccion-hint">
            Cada modalidad cobra distinto: semanal cada 7 días, mensual una vez
            al mes
          </span>
        </div>

        <div className="modalidad-cards">
          {resumen.modalidades.map((m) => (
            <button
              key={m.modalidad.key}
              className={`card card-modalidad card-mod-${m.modalidad.key} ${
                filtroModalidad === m.modalidad.key ? "active" : ""
              }`}
              onClick={() => {
                setFiltroModalidad(
                  filtroModalidad === m.modalidad.key ? null : m.modalidad.key,
                );
                setFiltroPlan("todos");
                setSoloPendientes(false);
                setPagina(1);
              }}
            >
              <div className="card-icon">{m.modalidad.icono}</div>
              <div className="card-info">
                <span className="card-label">{m.modalidad.label}</span>
                <span className="card-value">{m.cantidad}</span>
                <span className="card-sub">
                  {dinero(m.porCiclo)} facturado en cada ciclo ×{" "}
                  {m.modalidad.ciclosPorMes} = {dinero(m.mrr)}/mes
                </span>
              </div>
            </button>
          ))}

          <div className="card card-margen">
            <div className="card-icon">📐</div>
            <div className="card-info">
              <span className="card-label">Margen mensual estructural</span>
              <span
                className={`card-value ${margenMensual >= 0 ? "metrica-verde" : "metrica-rojo"}`}
              >
                {margenMensual.toFixed(1)}%
              </span>
              <span className="card-sub">
                MRR {dinero(resumen.mrr)} − menús{" "}
                {dinero(resumen.costoMensualMenus)}/mes
              </span>
            </div>
          </div>
        </div>

        {resumen.sinRegistrar.length > 0 && (
          <div className="aviso-plan aviso-registro">
            <strong>
              ⚠️ {resumen.sinRegistrar.length} cobro
              {resumen.sinRegistrar.length !== 1 ? "s" : ""} sin registrar en
              Firestore
            </strong>
            <p>
              Estos usuarios tienen plan de pago pero les falta información, así
              que su ingreso se está estimando. Se asume{" "}
              <em>modalidad mensual</em> cuando el campo no existe.
            </p>
            <ul className="lista-registro">
              {resumen.sinRegistrar.map((u) => (
                <li key={u.id}>
                  <button
                    className="link-usuario"
                    onClick={() => setDetalle(u)}
                  >
                    {u.nombre}
                  </button>{" "}
                  <span className={`plan-badge ${u.plan.color}`}>
                    {u.plan.label}
                  </span>{" "}
                  <span className="falta-tag">
                    falta{" "}
                    {[
                      u.faltaActivacion && "activatedAt",
                      u.faltaModalidad && "modalidad",
                    ]
                      .filter(Boolean)
                      .join(" y ")}
                  </span>
                </li>
              ))}
            </ul>
            <button
              className="btn-more btn-inline"
              onClick={() => {
                setSoloPendientes(true);
                setFiltroPlan("todos");
                setFiltroModalidad(null);
                setPagina(1);
              }}
            >
              Ver solo estos en la tabla
            </button>
          </div>
        )}
      </section>

      {/* ══════════════ C · Tabla de usuarios ══════════════ */}
      <section className="negocio-seccion">
        <div className="seccion-titulo">
          <h2>📋 Detalle de usuarios</h2>
          {(filtroPlan !== "todos" || filtroModalidad || soloPendientes) && (
            <button className="btn-limpiar" onClick={limpiarFiltros}>
              ✕ Quitar filtros
            </button>
          )}
        </div>

        <div className="toolbar">
          <input
            className="search-input"
            type="text"
            placeholder="🔍 Buscar por nombre, correo o teléfono..."
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              setPagina(1);
            }}
          />
          <span className="result-count">
            {usuariosFiltrados.length} resultado
            {usuariosFiltrados.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="table-wrapper">
          {visibles.length === 0 ? (
            <div className="detalle-empty">
              <div className="empty-icon">📭</div>
              <p>
                {loading
                  ? "Cargando usuarios..."
                  : "No se encontraron usuarios"}
              </p>
            </div>
          ) : (
            <table className="ig-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>Teléfono</th>
                  <th>Plan</th>
                  <th>Modalidad</th>
                  <th>Cobro</th>
                  <th>Registro</th>
                  <th>Activación</th>
                  <th>Próximo cobro</th>
                  <th>Menú</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((u, i) => (
                  <tr
                    key={u.id}
                    className={`tr-clickable ${u.cobroSinRegistrar ? "tr-alerta" : ""}`}
                    onClick={() => setDetalle(u)}
                    title="Ver detalle del usuario"
                  >
                    <td data-label="#">{i + 1}</td>
                    <td data-label="Nombre" className="td-name">
                      {u.nombre}
                      <span className="td-click-hint">→</span>
                    </td>
                    <td data-label="Correo" className="td-muted">
                      {u.correo}
                    </td>
                    <td data-label="Teléfono" className="td-muted">
                      {u.telefono}
                    </td>
                    <td data-label="Plan">
                      <span className={`plan-badge ${u.plan.color}`}>
                        {u.plan.label}
                      </span>
                    </td>
                    <td data-label="Modalidad">
                      {u.esPagado ? (
                        <span
                          className={`modalidad-badge ${u.modalidad.key} ${u.modalidad.asumida ? "asumida" : ""}`}
                          title={
                            u.modalidad.asumida
                              ? "El documento no trae modalidad: se asume mensual"
                              : ""
                          }
                        >
                          {u.modalidad.label}
                          {u.modalidad.asumida && " ?"}
                        </span>
                      ) : (
                        <span className="td-muted">—</span>
                      )}
                    </td>
                    <td
                      data-label="Cobro"
                      className={u.esPagado ? "td-ingreso" : "td-muted"}
                    >
                      {dinero(u.precioCiclo)}
                      {u.esPagado && (
                        <span className="td-sub">
                          {dinero(u.ingresoMensual)}/mes
                        </span>
                      )}
                    </td>
                    <td data-label="Registro" className="td-muted">
                      {formatearFecha(u.fechaRegistro)}
                    </td>
                    <td data-label="Activación" className="td-muted">
                      {u.fechaActivacion ? (
                        <>
                          {formatearFecha(u.fechaActivacion)}
                          {u.diasParaConvertir !== null && (
                            <span className="td-sub">
                              {u.diasParaConvertir}d para convertir
                            </span>
                          )}
                        </>
                      ) : u.esPagado ? (
                        <span className="falta-inline">sin registrar</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-label="Próximo cobro">
                      {u.proximoCobro ? (
                        <span className="pago-tag vigente">
                          {formatearFecha(u.proximoCobro)}
                          <span className="td-sub">
                            en {u.diasParaCobro}d · cobro #
                            {u.cobrosAcumulados + 1}
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-label="Menú">
                      {u.tieneMenu ? (
                        <span className="menu-si">✅</span>
                      ) : (
                        <span className="menu-no">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {restantes > 0 && (
          <button className="btn-more" onClick={() => setPagina((p) => p + 1)}>
            Cargar más ({restantes} restantes)
          </button>
        )}
      </section>

      {/* ══════════════ Movimiento del período ══════════════ */}
      <section className="negocio-seccion">
        <div className="seccion-titulo">
          <h2>💰 Movimiento del período</h2>
          <span className="seccion-hint">{periodoLabel}</span>
        </div>

        <div className="negocio-filtros">
          <select value={modo} onChange={(e) => setModo(e.target.value)}>
            <option value="dia">Por día</option>
            <option value="mes">Por mes</option>
            <option value="rango">Período personalizado</option>
          </select>
          {modo === "dia" ? (
            <input
              type="date"
              value={dia}
              onChange={(e) => setDia(e.target.value)}
            />
          ) : modo === "rango" ? (
            <>
              <label className="filtro-range-label">Desde</label>
              <input
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
              />
              <label className="filtro-range-label">Hasta</label>
              <input
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
              />
            </>
          ) : (
            <input
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
            />
          )}
        </div>

        <div className="negocio-metricas">
          <div className="metrica-card">
            <div className="metrica-icon">🆕</div>
            <div className="metrica-info">
              <span className="metrica-label">Nuevos registros</span>
              <span className="metrica-valor">{registradosPeriodo.length}</span>
              <span className="metrica-sub">por fecha de registro</span>
            </div>
          </div>
          <div className="metrica-card">
            <div className="metrica-icon">🎉</div>
            <div className="metrica-info">
              <span className="metrica-label">Nuevas activaciones</span>
              <span className="metrica-valor metrica-verde">
                {activadosPeriodo.length}
              </span>
              <span className="metrica-sub">pasaron de free a pago</span>
            </div>
          </div>
          <div className="metrica-card">
            <div className="metrica-icon">🧾</div>
            <div className="metrica-info">
              <span className="metrica-label">Cobros del período</span>
              <span className="metrica-valor">{cobrosPeriodo.length}</span>
              <span className="metrica-sub">
                {cobrosPeriodo.filter((c) => c.estimado).length} estimados
              </span>
            </div>
          </div>
          <div className="metrica-card">
            <div className="metrica-icon">⏱️</div>
            <div className="metrica-info">
              <span className="metrica-label">Días para convertir</span>
              <span className="metrica-valor">
                {diasPromedioConversion !== null
                  ? diasPromedioConversion.toFixed(1)
                  : "—"}
              </span>
              <span className="metrica-sub">promedio del período</span>
            </div>
          </div>
          <div className="metrica-card">
            <div className="metrica-icon">📊</div>
            <div className="metrica-info">
              <span className="metrica-label">Margen del período</span>
              <span
                className={`metrica-valor ${margenBruto >= 50 ? "metrica-verde" : "metrica-rojo"}`}
              >
                {margenBruto.toFixed(1)}%
              </span>
              <span className="metrica-sub">ingresos vs. costo de menús</span>
            </div>
          </div>
          <div className="metrica-card">
            <div className="metrica-icon">🎯</div>
            <div className="metrica-info">
              <span className="metrica-label">ROI neto</span>
              <span
                className={`metrica-valor ${balance >= 0 ? "metrica-verde" : "metrica-rojo"}`}
              >
                {roi.toFixed(1)}%
              </span>
              <span className="metrica-sub">balance sobre egresos</span>
            </div>
          </div>
        </div>

        <div className="negocio-resumen">
          <div className="resumen-card ingreso">
            <div className="card-icon">📈</div>
            <div className="card-info">
              <span className="card-label">Ingresos cobrados</span>
              <span className="card-value">{dinero(totalIngresos)}</span>
            </div>
          </div>
          <div className="resumen-card gasto">
            <div className="card-icon">🛒</div>
            <div className="card-info">
              <span className="card-label">Compras bodega</span>
              <span className="card-value">{dinero(totalCompras)}</span>
            </div>
          </div>
          <div className="resumen-card menu-cost">
            <div className="card-icon">🍽️</div>
            <div className="card-info">
              <span className="card-label">Costos menús</span>
              <span className="card-value">{dinero(totalCostosMenus)}</span>
            </div>
          </div>
          <div
            className={`resumen-card balance ${balance >= 0 ? "balance-positivo" : "balance-negativo"}`}
          >
            <div className="card-icon">{balance >= 0 ? "✅" : "⚠️"}</div>
            <div className="card-info">
              <span className="card-label">Balance neto</span>
              <span className="card-value">
                {balance >= 0 ? "+" : ""}
                {dinero(balance)}
              </span>
            </div>
          </div>
        </div>

        <div className="panel">
          <h3>Distribución de ingresos y egresos</h3>
          <div className="bar-wrapper">
            <div
              className="bar-seg bar-ingreso"
              style={{ width: `${pctIngreso}%` }}
            />
            <div
              className="bar-seg bar-gasto-compras"
              style={{ width: `${pctCompras}%` }}
            />
            <div
              className="bar-seg bar-gasto-menus"
              style={{ width: `${pctMenus}%` }}
            />
          </div>
          <div className="bar-labels">
            <span className="label-ingreso">
              Ingresos {pctIngreso.toFixed(0)}%
            </span>
            <span className="label-gasto-compras">
              Compras {pctCompras.toFixed(0)}%
            </span>
            <span className="label-gasto-menus">
              Menús {pctMenus.toFixed(0)}%
            </span>
          </div>
        </div>
      </section>

      {/* ══════════════ Detalle ingresos / gastos ══════════════ */}
      <section className="negocio-seccion negocio-detalle">
        <div className="detalle-card">
          <h3>
            <span>📈</span> Cobros del período
          </h3>
          {cobrosPeriodo.length === 0 ? (
            <div className="detalle-empty">
              <div className="empty-icon">📭</div>
              <p>Sin cobros en este período</p>
            </div>
          ) : (
            <table className="ig-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Cliente</th>
                  <th>Plan</th>
                  <th>Modalidad</th>
                  <th>Fecha</th>
                  <th>Monto</th>
                </tr>
              </thead>
              <tbody>
                {cobrosPeriodo.map((c, i) => (
                  <tr key={`${c.usuario.id}-${c.fecha}`}>
                    <td data-label="#">{i + 1}</td>
                    <td data-label="Cliente" className="td-name">
                      {c.usuario.nombre}
                    </td>
                    <td data-label="Plan">
                      <span className={`plan-badge ${c.usuario.plan.color}`}>
                        {c.usuario.plan.label}
                      </span>
                    </td>
                    <td data-label="Modalidad">
                      <span
                        className={`modalidad-badge ${c.usuario.modalidad.key}`}
                      >
                        {c.usuario.modalidad.label}
                      </span>
                    </td>
                    <td data-label="Fecha" className="td-muted">
                      {formatearFecha(c.fecha)}
                      {c.estimado && <span className="est-tag">est.</span>}
                    </td>
                    <td data-label="Monto" className="td-ingreso">
                      {dinero(c.monto)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="5">
                    {cobrosPeriodo.length} cobro
                    {cobrosPeriodo.length !== 1 ? "s" : ""} ·{" "}
                    {cobrosPeriodo.filter((c) => c.estimado).length} estimado
                    {cobrosPeriodo.filter((c) => c.estimado).length !== 1
                      ? "s"
                      : ""}
                  </td>
                  <td className="td-ingreso">{dinero(totalIngresos)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div className="detalle-card">
          <h3>
            <span>📉</span> Compras del período
          </h3>
          {gastosPeriodo.length === 0 ? (
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
                {[...gastosPeriodo]
                  .sort((a, b) => (b.fecha || 0) - (a.fecha || 0))
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
                        {dinero(g.costo)}
                      </td>
                      <td data-label="Fecha" className="td-muted">
                        {formatearFecha(g.fecha)}
                      </td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="3">
                    {gastosPeriodo.length} compra
                    {gastosPeriodo.length !== 1 ? "s" : ""}
                  </td>
                  <td colSpan="2" className="td-gasto">
                    {dinero(totalCompras)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </section>

      {/* ══════════════ Rentabilidad por usuario ══════════════ */}
      <section className="negocio-seccion">
        <div className="detalle-card">
          <h3>
            <span>🍽️</span> Rentabilidad mensual por usuario
          </h3>
          <p className="detalle-nota">
            El menú cubre 5 días (una semana), así que se multiplica por{" "}
            {SEMANAS_POR_MES} para compararlo contra el ingreso mensual. Las
            filas en rojo pierden dinero.
          </p>
          {costosMenu.length === 0 ? (
            <div className="detalle-empty">
              <div className="empty-icon">📭</div>
              <p>Ningún usuario tiene menú creado</p>
            </div>
          ) : (
            <table className="ig-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Cliente</th>
                  <th>Plan</th>
                  <th>Modalidad</th>
                  <th>Ingreso / mes</th>
                  <th>Costo menú / mes</th>
                  <th>Ganancia / mes</th>
                  <th>Margen</th>
                  <th>En el período</th>
                </tr>
              </thead>
              <tbody>
                {costosMenu.map((item, i) => (
                  <tr
                    key={item.usuario.id}
                    className={`tr-clickable ${item.gananciaMensual < 0 ? "fila-perdida" : ""}`}
                    onClick={() => setDetalle(item.usuario)}
                    title="Ver desglose de ingredientes"
                  >
                    <td data-label="#">{i + 1}</td>
                    <td data-label="Cliente" className="td-name">
                      {item.usuario.nombre}
                      <span className="td-click-hint">→</span>
                    </td>
                    <td data-label="Plan">
                      <span className={`plan-badge ${item.usuario.plan.color}`}>
                        {item.usuario.plan.label}
                      </span>
                    </td>
                    <td data-label="Modalidad">
                      <span
                        className={`modalidad-badge ${item.usuario.modalidad.key} ${item.usuario.modalidad.asumida ? "asumida" : ""}`}
                      >
                        {item.usuario.modalidad.label}
                        {item.usuario.modalidad.asumida && " ?"}
                      </span>
                    </td>
                    <td
                      data-label="Ingreso / mes"
                      className={
                        item.usuario.esPagado ? "td-ingreso" : "td-muted"
                      }
                    >
                      {dinero(item.usuario.ingresoMensual)}
                    </td>
                    <td data-label="Costo menú / mes" className="td-gasto">
                      {dinero(item.costoMensual)}
                      <span className="td-sub">
                        {dinero(item.costoSemanal)}/semana
                      </span>
                    </td>
                    <td
                      data-label="Ganancia / mes"
                      className={
                        item.gananciaMensual >= 0 ? "td-ingreso" : "td-gasto"
                      }
                    >
                      {item.gananciaMensual >= 0 ? "+" : ""}
                      {dinero(item.gananciaMensual)}
                    </td>
                    <td data-label="Margen">
                      {item.margen === null ? (
                        <span className="td-muted">—</span>
                      ) : (
                        <span
                          className={
                            item.margen >= 0 ? "metrica-verde" : "metrica-rojo"
                          }
                        >
                          {item.margen.toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td data-label="En el período" className="td-muted">
                      {item.semanasPeriodo} sem · {dinero(item.costoPeriodo)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="4">
                    {costosMenu.length} menú
                    {costosMenu.length !== 1 ? "s" : ""}
                  </td>
                  <td className="td-ingreso">
                    {dinero(
                      costosMenu.reduce(
                        (a, c) => a + c.usuario.ingresoMensual,
                        0,
                      ),
                    )}
                  </td>
                  <td className="td-gasto">
                    {dinero(costosMenu.reduce((a, c) => a + c.costoMensual, 0))}
                  </td>
                  <td
                    className={
                      costosMenu.reduce((a, c) => a + c.gananciaMensual, 0) >= 0
                        ? "td-ingreso"
                        : "td-gasto"
                    }
                  >
                    {dinero(
                      costosMenu.reduce((a, c) => a + c.gananciaMensual, 0),
                    )}
                  </td>
                  <td colSpan="2" className="td-gasto">
                    {dinero(totalCostosMenus)} en el período
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </section>

      {/* ══════════════ Modal de usuario ══════════════ */}
      {detalle && (
        <ModalUsuario
          usuario={detalle}
          bodega={bodega}
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  );
}

// ── Modal: datos de contacto + cobro + desglose de ingredientes ──
function ModalUsuario({ usuario: u, bodega, onClose }) {
  const { costoSemanal, costoMensual, detalle, faltantes } = useMemo(
    () => calcularCostoMenu(u.menuCreado, bodega),
    [u.menuCreado, bodega],
  );
  const ganancia = u.ingresoMensual - costoMensual;
  const ingredientes = Object.entries(detalle).sort(
    (a, b) => b[1].costoTotal - a[1].costoTotal,
  );

  return (
    <div className="usuario-modal-overlay" onClick={onClose}>
      <div className="usuario-modal" onClick={(e) => e.stopPropagation()}>
        <button className="usuario-modal-close" onClick={onClose}>
          ✕
        </button>

        <div className="usuario-modal-header">
          <p className="usuario-modal-name">{u.nombre}</p>
          <span className={`plan-badge ${u.plan.color}`}>
            {u.plan.icono} {u.plan.label}
          </span>{" "}
          {u.esPagado && (
            <span
              className={`modalidad-badge ${u.modalidad.key} ${u.modalidad.asumida ? "asumida" : ""}`}
            >
              {u.modalidad.icono} {u.modalidad.label}
              {u.modalidad.asumida && " (asumida)"}
            </span>
          )}
        </div>

        <div className="usuario-modal-datos">
          <div className="dato-item">
            <span>Correo</span>
            <strong>{u.correo}</strong>
          </div>
          <div className="dato-item">
            <span>Teléfono</span>
            <strong>{u.telefono}</strong>
          </div>
          <div className="dato-item">
            <span>Registro</span>
            <strong>{formatearFecha(u.fechaRegistro)}</strong>
          </div>
          <div className="dato-item">
            <span>Activación</span>
            <strong className={u.faltaActivacion ? "td-gasto" : ""}>
              {u.fechaActivacion
                ? formatearFecha(u.fechaActivacion)
                : u.esPagado
                  ? "Sin registrar"
                  : "Nunca pagó"}
            </strong>
          </div>
          <div className="dato-item">
            <span>Precio por cobro</span>
            <strong>
              {dinero(u.precioCiclo)}
              {u.esPagado &&
                ` / ${u.modalidad.key === "semanal" ? "semana" : "mes"}`}
            </strong>
          </div>
          <div className="dato-item">
            <span>Ingreso mensual</span>
            <strong>{dinero(u.ingresoMensual)}</strong>
          </div>
          <div className="dato-item">
            <span>Próximo cobro</span>
            <strong>
              {u.proximoCobro
                ? `${formatearFecha(u.proximoCobro)} · en ${u.diasParaCobro}d`
                : "—"}
            </strong>
          </div>
          <div className="dato-item">
            <span>Cobros acumulados</span>
            <strong>{u.cobrosAcumulados}</strong>
          </div>
          <div className="dato-item">
            <span>Menú creado</span>
            <strong>
              {u.tieneMenu ? formatearFecha(u.fechaMenuCreado) : "Sin menú"}
            </strong>
          </div>
        </div>

        <div className="usuario-modal-totales">
          <div className="modal-total-item">
            <span>Ingreso / mes</span>
            <span className={u.esPagado ? "td-ingreso" : "td-muted"}>
              {dinero(u.ingresoMensual)}
            </span>
          </div>
          <div className="modal-total-item">
            <span>Costo menú / mes</span>
            <span className="td-gasto">
              {dinero(costoMensual)}
              <em className="modal-sub">
                {dinero(costoSemanal)} × {SEMANAS_POR_MES} sem
              </em>
            </span>
          </div>
          <div className="modal-total-item modal-balance">
            <span>Ganancia / mes</span>
            <span className={ganancia >= 0 ? "td-ingreso" : "td-gasto"}>
              {ganancia >= 0 ? "+" : ""}
              {dinero(ganancia)}
            </span>
          </div>
        </div>

        <h4 className="usuario-modal-desglose-title">
          🧾 Desglose de ingredientes (una semana)
        </h4>
        {ingredientes.length === 0 ? (
          <div className="detalle-empty">
            <div className="empty-icon">📭</div>
            <p>
              {u.tieneMenu
                ? "Los ingredientes de este menú no están en bodega"
                : "Este usuario todavía no tiene menú creado"}
            </p>
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
              {ingredientes.map(([nombre, info]) => (
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
                    {dinero(info.costoTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="3">
                  {ingredientes.length} ingrediente
                  {ingredientes.length !== 1 ? "s" : ""} · semana
                </td>
                <td className="td-gasto">{dinero(costoSemanal)}</td>
              </tr>
            </tfoot>
          </table>
        )}

        {faltantes.length > 0 && (
          <div className="aviso-plan aviso-faltantes">
            ⚠️ {faltantes.length} ingrediente
            {faltantes.length !== 1 ? "s" : ""} del menú no están en bodega, así
            que el costo real es mayor: {faltantes.join(", ")}.
          </div>
        )}
      </div>
    </div>
  );
}

export default ControlNegocio;
