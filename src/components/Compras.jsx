import { useState, useEffect, useMemo, useCallback } from "react";
import "./Compras.css";
import { doc, setDoc, getDoc, collection, getDocs, deleteDoc } from "firebase/firestore";
import { db } from "../firbase/Firebase";
import { useUsuarios } from "../services/usuarios";
import { calcularListaCompras } from "../services/compras";
import { claveIngrediente } from "../services/costos";

const UNIDADES = [
  { value: "g", label: "Gramos (g)" },
  { value: "ml", label: "Mililitros (ml)" },
  { value: "ud", label: "Unidades (ud)" },
];

const ORIGEN = {
  menu: { icon: "🍽️", label: "menú", clase: "origen-menu" },
  stock: { icon: "📦", label: "stock bajo", clase: "origen-stock" },
  manual: { icon: "✋", label: "manual", clase: "origen-manual" },
};

// Las cantidades salen de sumar muchos ingredientes: sin redondeo quedan
// números como 1350.0000000002
const fmtCant = (n) =>
  !Number.isFinite(n) ? "0" : Number.isInteger(n) ? String(n) : n.toFixed(1);

const fmtCostoUnidad = (val) => {
  if (!val) return "0.00";
  if (val >= 1) return val.toFixed(2);
  if (val >= 0.01) return val.toFixed(4);
  return val.toFixed(8);
};

const unidadLabel = (u) => {
  if (u === "g") return "gramos";
  if (u === "ml") return "mililitros";
  return "unidades";
};

// La cantidad no siempre es necesario − stock: cuando el ingrediente además
// está bajo el mínimo de bodega se compra lo que haga falta para llegar al
// máximo. Sin esta explicación los números de la fila parecen no cuadrar.
const motivoTitulo = (c) =>
  [
    `Para la semana faltan ${c.porMenu} ${c.unidad}`,
    c.porStock > 0 ? `Para llegar al máximo de bodega: ${c.porStock} ${c.unidad}` : null,
    c.porManual > 0 ? `Agregado manual: ${c.porManual} ${c.unidad}` : null,
    `Se compra el mayor: ${c.cantidadComprar} ${c.unidad}`,
  ]
    .filter(Boolean)
    .join("\n");

function Compras() {
  const { usuarios, loading, refrescar } = useUsuarios();

  // Bodega en estado local (no useBodega): al confirmar una compra hay que
  // actualizar el stock en memoria para que la lista se recalcule sola.
  const [bodega, setBodega] = useState([]);
  // compras/lista_compras ahora guarda SOLO agregados manuales (botón 🛒 de Bodega)
  const [extras, setExtras] = useState([]);
  const [gastos, setGastos] = useState([]);

  const [expandido, setExpandido] = useState(null);
  // "todo" | "faltan" | "cubiertos"
  const [vista, setVista] = useState("todo");

  const [filtro, setFiltro] = useState("mes"); // "dia" o "mes"
  const [fechaFiltro, setFechaFiltro] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [mesFiltro, setMesFiltro] = useState(
    new Date().toISOString().slice(0, 7),
  );

  const [modalItem, setModalItem] = useState(null);
  const [modalCantidad, setModalCantidad] = useState("");
  const [modalCosto, setModalCosto] = useState("");
  const [modalUnidad, setModalUnidad] = useState("g");

  // ── Carga inicial ──
  useEffect(() => {
    getDoc(doc(db, "bodega", "mi_bodega"))
      .then((snap) => {
        if (snap.exists()) setBodega(snap.data().ingredientes || []);
      })
      .catch((err) => console.error("Error cargando bodega:", err));

    getDoc(doc(db, "compras", "lista_compras"))
      .then((snap) => {
        if (snap.exists()) setExtras(snap.data().items || []);
      })
      .catch((err) => console.error("Error cargando agregados manuales:", err));
  }, []);

  useEffect(() => {
    getDocs(collection(db, "gastos"))
      .then((snap) =>
        setGastos(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              ...data,
              fecha: data.fecha?.toDate
                ? data.fecha.toDate().toISOString()
                : data.fecha,
            };
          }),
        ),
      )
      .catch((err) => console.error("Error cargando gastos:", err));
  }, []);

  // ── La lista se calcula en vivo: menús − bodega ──
  const { items, resumen } = useMemo(
    () => calcularListaCompras(usuarios, bodega, extras),
    [usuarios, bodega, extras],
  );

  const visibles = useMemo(() => {
    if (vista === "faltan") return items.filter((i) => !i.cubierto);
    if (vista === "cubiertos") return items.filter((i) => i.cubierto);
    return items;
  }, [items, vista]);

  const guardarExtras = useCallback((nuevos) => {
    setExtras(nuevos);
    setDoc(doc(db, "compras", "lista_compras"), {
      items: nuevos,
      updatedAt: new Date(),
    }).catch((err) => console.error("Error guardando agregados:", err));
  }, []);

  // Solo los agregados a mano se pueden quitar: las filas calculadas volverían
  // a aparecer en el siguiente render.
  const quitarManual = (item) => {
    guardarExtras(extras.filter((e) => claveIngrediente(e.nombre) !== item.clave));
  };

  const handleEliminarGasto = (id) => {
    setGastos((prev) => prev.filter((g) => g.id !== id));
    deleteDoc(doc(db, "gastos", id)).catch((err) =>
      console.error("Error eliminando gasto:", err),
    );
  };

  const abrirModal = (item) => {
    setModalItem(item);
    setModalCantidad(String(Math.ceil(item.cantidadComprar)));
    setModalCosto(item.costoEstimado > 0 ? item.costoEstimado.toFixed(2) : "");
    setModalUnidad(item.unidad);
  };

  const cerrarModal = () => {
    setModalItem(null);
    setModalCantidad("");
    setModalCosto("");
  };

  const confirmarComprado = async () => {
    if (!modalItem) return;
    const cantidadComprada = parseFloat(modalCantidad) || 0;
    const costoFinal = parseFloat(modalCosto) || 0;
    if (cantidadComprada <= 0) return;
    const costoPorUnidad = costoFinal / cantidadComprada;

    // 1. Registrar el gasto (lo lee Control del Negocio para el balance)
    const gastoId = Date.now().toString();
    const nuevoGasto = {
      id: gastoId,
      ingrediente: modalItem.nombre,
      cantidad: cantidadComprada,
      unidad: modalUnidad,
      costo: costoFinal,
      fecha: new Date().toISOString(),
    };
    setGastos((prev) => [...prev, nuevoGasto]);
    setDoc(doc(db, "gastos", gastoId), {
      ingrediente: nuevoGasto.ingrediente,
      cantidad: nuevoGasto.cantidad,
      unidad: nuevoGasto.unidad,
      costo: nuevoGasto.costo,
      fecha: new Date(),
    }).catch((err) => console.error("Error guardando gasto:", err));

    // 2. Subir el stock en bodega. Se relee el documento antes de escribir:
    //    la pestaña Bodega pudo haberlo modificado desde que se montó esta.
    try {
      const snap = await getDoc(doc(db, "bodega", "mi_bodega"));
      const actuales = snap.exists() ? snap.data().ingredientes || [] : [];
      const idx = actuales.findIndex(
        (i) => claveIngrediente(i.nombre) === modalItem.clave,
      );

      let nuevos;
      if (idx >= 0) {
        nuevos = actuales.map((i, k) =>
          k !== idx
            ? i
            : {
                ...i,
                cantidad: (i.cantidad || 0) + cantidadComprada,
                cantidadUltimaCompra: cantidadComprada,
                costoTotal: costoFinal > 0 ? costoFinal : i.costoTotal,
                costoPorUnidad:
                  costoPorUnidad > 0 ? costoPorUnidad : i.costoPorUnidad,
              },
        );
      } else {
        // El ingrediente venía de un menú y nunca estuvo en bodega: se crea con
        // la misma forma que usa Bodega.jsx, si no jamás se podría costear.
        nuevos = [
          ...actuales,
          {
            id: Date.now().toString() + Math.random().toString(36).slice(2),
            nombre: modalItem.nombre,
            cantidad: cantidadComprada,
            cantidadExistente: cantidadComprada,
            cantidadUltimaCompra: cantidadComprada,
            cantidadMinima: null,
            cantidadMaxima: cantidadComprada,
            costoTotal: costoFinal,
            costoPorUnidad,
            unidad: modalUnidad,
            createdAt: new Date().toISOString(),
          },
        ];
      }

      setBodega(nuevos);
      await setDoc(doc(db, "bodega", "mi_bodega"), {
        ingredientes: nuevos,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error("Error actualizando bodega:", error);
    }

    // 3. Si era un agregado manual, ya cumplió su función
    if (modalItem.manual) quitarManual(modalItem);

    cerrarModal();
  };

  const gastosFiltrados = gastos.filter((g) => {
    if (!g.fecha) return false;
    const fechaStr =
      typeof g.fecha === "string" ? g.fecha : new Date(g.fecha).toISOString();
    return filtro === "dia"
      ? fechaStr.slice(0, 10) === fechaFiltro
      : fechaStr.slice(0, 7) === mesFiltro;
  });
  const totalGastos = gastosFiltrados.reduce((a, g) => a + (g.costo || 0), 0);

  return (
    <div className="compras">
      <header className="compras-header">
        <div className="compras-header-top">
          <div>
            <h1>🛒 Lista de Compras</h1>
            <p className="subtitle">
              Lo que falta para cubrir una semana de{" "}
              {resumen.usuariosConMenu} usuario
              {resumen.usuariosConMenu !== 1 ? "s" : ""} con menú
            </p>
          </div>
          <button
            className="btn-refrescar"
            onClick={refrescar}
            disabled={loading}
            title="Volver a leer los menús desde Firebase"
          >
            {loading ? "⏳ Cargando…" : "🔄 Actualizar menús"}
          </button>
        </div>
      </header>

      <div className="compras-stats">
        <div className="compras-stat">
          <div className="stat-icon">👥</div>
          <div className="stat-info">
            <span className="stat-label">Usuarios con menú</span>
            <span className="stat-value">{resumen.usuariosConMenu}</span>
          </div>
        </div>
        <div className="compras-stat">
          <div className="stat-icon">🍽️</div>
          <div className="stat-info">
            <span className="stat-label">Ingredientes en los menús</span>
            <span className="stat-value">{resumen.ingredientesEnMenus}</span>
          </div>
        </div>
        <div className="compras-stat">
          <div className="stat-icon">📋</div>
          <div className="stat-info">
            <span className="stat-label">Falta comprar</span>
            <span className="stat-value">{resumen.porComprar}</span>
          </div>
        </div>
        <div className="compras-stat">
          <div className="stat-icon">💵</div>
          <div className="stat-info">
            <span className="stat-label">Costo de la compra</span>
            <span className="stat-value">
              ${resumen.costoEstimado.toFixed(2)}
            </span>
          </div>
        </div>
        {resumen.sinRegistrarEnBodega > 0 && (
          <div className="compras-stat stat-warning">
            <div className="stat-icon">⚠️</div>
            <div className="stat-info">
              <span className="stat-label">Sin registrar en bodega</span>
              <span className="stat-value">{resumen.sinRegistrarEnBodega}</span>
            </div>
          </div>
        )}
      </div>

      {resumen.sinRegistrarEnBodega > 0 && (
        <div className="compras-aviso">
          ⚠️ Hay {resumen.sinRegistrarEnBodega} ingrediente
          {resumen.sinRegistrarEnBodega !== 1 ? "s" : ""} que los menús piden
          pero no existe{resumen.sinRegistrarEnBodega !== 1 ? "n" : ""} en
          bodega. No se pueden costear, así que el costo estimado real es mayor.
          Al confirmar su compra se crean en bodega automáticamente.
        </div>
      )}

      {items.length > 0 && (
        <div className="filtros-vista">
          {[
            { key: "todo", label: "Todo", n: resumen.totalItems },
            { key: "faltan", label: "Falta comprar", n: resumen.porComprar },
            { key: "cubiertos", label: "Cubierto", n: resumen.cubiertos },
          ].map((f) => (
            <button
              key={f.key}
              className={`chip-filtro ${vista === f.key ? "activo" : ""}`}
              onClick={() => setVista(f.key)}
            >
              {f.label} <span className="chip-n">{f.n}</span>
            </button>
          ))}
        </div>
      )}

      {visibles.length === 0 ? (
        <div className="compras-empty">
          <div className="empty-icon">{items.length > 0 ? "🔍" : "✅"}</div>
          <p>
            {resumen.usuariosConMenu === 0
              ? "Todavía no hay usuarios con menú creado."
              : items.length === 0
                ? "Los menús no tienen ingredientes cargados."
                : vista === "faltan"
                  ? "La bodega cubre toda la semana. No hay nada que comprar."
                  : "No hay ingredientes cubiertos por la bodega."}
          </p>
        </div>
      ) : (
        <div className="compras-list-card">
          <table className="compras-table compras-table-lista">
            <thead>
              <tr>
                <th>#</th>
                <th>Ingrediente</th>
                <th>Necesita semana</th>
                <th>En bodega</th>
                <th>Falta comprar</th>
                <th>Costo/Unidad</th>
                <th>Costo compra</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((c, i) => {
                const badge = ORIGEN[c.origen];
                const abierto = expandido === c.id;
                return [
                  <tr key={c.id} className={c.cubierto ? "row-cubierto" : ""}>
                    <td data-label="#">{i + 1}</td>
                    <td data-label="Ingrediente" className="td-name">
                      <button
                        className="td-nombre-btn"
                        onClick={() => setExpandido(abierto ? null : c.id)}
                        title="Ver qué usuarios lo piden"
                      >
                        {c.usuarios.length > 0 && (
                          <span className="expand-caret">
                            {abierto ? "▾" : "▸"}
                          </span>
                        )}
                        {c.nombre}
                      </button>
                      <span className={`origen-badge ${badge.clase}`}>
                        {badge.icon} {badge.label}
                      </span>
                      {c.origen === "menu" && c.bajoMinimo && (
                        <span className="origen-badge origen-stock">
                          📦 bajo mínimo
                        </span>
                      )}
                      {!c.enBodega && (
                        <span className="origen-badge origen-falta">
                          ⚠️ no está en bodega
                        </span>
                      )}
                    </td>
                    <td data-label="Necesita semana" className="td-need">
                      {c.necesario > 0 ? (
                        <>
                          <span>
                            {fmtCant(c.necesario)} {c.unidad}
                          </span>
                          {c.costoNecesario > 0 && (
                            <span
                              className="need-costo"
                              title="Lo que cuesta cubrir la demanda de los menús esta semana"
                            >
                              ${c.costoNecesario.toFixed(2)} la semana
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-label="En bodega" className="td-low">
                      {fmtCant(c.stock)} {c.unidad}
                    </td>
                    <td data-label="Falta comprar" className="td-qty">
                      {c.cubierto ? (
                        <span className="badge-cubierto">
                          ✔ cubierto por bodega
                        </span>
                      ) : (
                        <>
                          <span>
                            {fmtCant(c.cantidadComprar)} {unidadLabel(c.unidad)}
                          </span>
                          {c.motivo !== "semana" && (
                            <span className="qty-motivo" title={motivoTitulo(c)}>
                              {c.motivo === "minimo"
                                ? `repone al máximo (la semana solo pide ${fmtCant(c.porMenu)})`
                                : "agregado manual"}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td data-label="Costo/Unidad" className="td-cost">
                      {c.costoPorUnidad > 0
                        ? `$${fmtCostoUnidad(c.costoPorUnidad)}/${c.unidad}`
                        : "—"}
                    </td>
                    <td data-label="Costo compra" className="td-total">
                      {c.costoEstimado > 0
                        ? `$${c.costoEstimado.toFixed(2)}`
                        : "—"}
                    </td>
                    <td data-label="Acción">
                      {/* Si la bodega alcanza no hay nada que comprar */}
                      {c.cubierto ? (
                        <span className="sin-accion">ya hay suficiente</span>
                      ) : (
                        <button
                          className="btn-comprado"
                          onClick={() => abrirModal(c)}
                        >
                          ✅ Comprado
                        </button>
                      )}
                      {c.manual && (
                        <button
                          className="btn-eliminar-compra"
                          onClick={() => quitarManual(c)}
                          title="Quitar el agregado manual"
                        >
                          🗑️
                        </button>
                      )}
                    </td>
                  </tr>,
                  abierto && c.usuarios.length > 0 ? (
                    <tr key={`${c.id}-detalle`} className="row-detalle">
                      <td colSpan="8">
                        <div className="detalle-usuarios">
                          <span className="detalle-titulo">
                            Lo piden {c.usuarios.length} menú
                            {c.usuarios.length !== 1 ? "s" : ""}:
                          </span>
                          <ul>
                            {c.usuarios.map((u) => (
                              <li key={u.id}>
                                <span className="detalle-nombre">
                                  {u.nombre}
                                </span>
                                <span className="detalle-qty">
                                  {fmtCant(u.qty)} {c.unidad}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="6" className="total-label">
                  Costo de la compra
                </td>
                <td className="total-value" colSpan="2">
                  ${resumen.costoEstimado.toFixed(2)}
                </td>
              </tr>
              <tr className="total-secundario">
                <td colSpan="6" className="total-label">
                  Costo semanal de los menús (todo lo que se necesita)
                </td>
                <td className="total-value" colSpan="2">
                  ${resumen.costoNecesarioSemana.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── Historial de Gastos ── */}
      <div className="gastos-section">
        <div className="gastos-header">
          <h2>📊 Historial de Compras</h2>
          <div className="gastos-filtros">
            <select
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              className="filtro-select"
            >
              <option value="dia">Por día</option>
              <option value="mes">Por mes</option>
            </select>
            {filtro === "dia" ? (
              <input
                type="date"
                value={fechaFiltro}
                onChange={(e) => setFechaFiltro(e.target.value)}
                className="filtro-input"
              />
            ) : (
              <input
                type="month"
                value={mesFiltro}
                onChange={(e) => setMesFiltro(e.target.value)}
                className="filtro-input"
              />
            )}
          </div>
        </div>

        <div className="gastos-total-bar">
          <span>
            {gastosFiltrados.length} compra
            {gastosFiltrados.length !== 1 ? "s" : ""}
          </span>
          <span className="gastos-total-value">
            Total: ${totalGastos.toFixed(2)}
          </span>
        </div>

        {gastosFiltrados.length === 0 ? (
          <div className="compras-empty">
            <div className="empty-icon">📭</div>
            <p>No hay compras registradas en este período.</p>
          </div>
        ) : (
          <table className="compras-table gastos-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Ingrediente</th>
                <th>Cantidad</th>
                <th>Costo</th>
                <th>Fecha</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...gastosFiltrados]
                .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
                .map((g, i) => (
                  <tr key={g.id || i}>
                    <td data-label="#">{i + 1}</td>
                    <td data-label="Ingrediente" className="td-name">
                      {g.ingrediente}
                    </td>
                    <td data-label="Cantidad" className="td-qty">
                      {g.cantidad} {g.unidad}
                    </td>
                    <td data-label="Costo" className="td-total">
                      ${(g.costo || 0).toFixed(2)}
                    </td>
                    <td data-label="Fecha" className="td-cost">
                      {new Date(g.fecha).toLocaleDateString("es", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td data-label="">
                      <button
                        className="btn-eliminar-compra"
                        onClick={() => handleEliminarGasto(g.id)}
                        title="Eliminar registro"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="3" className="total-label">
                  Total del período
                </td>
                <td colSpan="3" className="total-value">
                  ${totalGastos.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* ── Modal confirmar compra ── */}
      {modalItem && (
        <div className="modal-overlay" onClick={cerrarModal}>
          <div className="modal-compra" onClick={(e) => e.stopPropagation()}>
            <h3>✅ Confirmar compra</h3>
            <p className="modal-ingrediente">{modalItem.nombre}</p>

            {modalItem.necesario > 0 && (
              <p className="modal-contexto">
                Los menús piden {fmtCant(modalItem.necesario)} {modalItem.unidad}{" "}
                esta semana y en bodega hay {fmtCant(modalItem.stock)}{" "}
                {modalItem.unidad}.
              </p>
            )}

            {!modalItem.enBodega && (
              <div className="modal-field">
                <label>Unidad (se creará en bodega)</label>
                <select
                  value={modalUnidad}
                  onChange={(e) => setModalUnidad(e.target.value)}
                >
                  {UNIDADES.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="modal-field">
              <label>Cantidad comprada ({modalUnidad})</label>
              <input
                type="number"
                min="0"
                step="any"
                value={modalCantidad}
                onChange={(e) => setModalCantidad(e.target.value)}
              />
            </div>
            <div className="modal-field">
              <label>Costo del paquete ($)</label>
              <input
                type="number"
                min="0"
                step="any"
                value={modalCosto}
                onChange={(e) => setModalCosto(e.target.value)}
              />
            </div>
            <div className="modal-info">
              <span>Costo por {modalUnidad}:</span>
              <strong>
                $
                {parseFloat(modalCantidad) > 0
                  ? (
                      parseFloat(modalCosto) / parseFloat(modalCantidad)
                    ).toFixed(4)
                  : "0.0000"}
              </strong>
            </div>
            <div className="modal-actions">
              <button className="btn-cancelar-modal" onClick={cerrarModal}>
                Cancelar
              </button>
              <button
                className="btn-confirmar-modal"
                onClick={confirmarComprado}
              >
                Confirmar compra
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Compras;
