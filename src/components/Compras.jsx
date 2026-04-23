import { useState, useEffect } from "react";
import "./Compras.css";
import {
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
} from "firebase/firestore";
import { db } from "../firbase/Firebase";

function Compras() {
  const [compras, setCompras] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [filtro, setFiltro] = useState("mes"); // "dia" o "mes"
  const [modalItem, setModalItem] = useState(null); // item pendiente de confirmar
  const [modalCantidad, setModalCantidad] = useState("");
  const [modalCosto, setModalCosto] = useState("");
  const [fechaFiltro, setFechaFiltro] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [mesFiltro, setMesFiltro] = useState(
    new Date().toISOString().slice(0, 7),
  );

  // Cargar lista de compras desde Firebase
  useEffect(() => {
    const cargar = async () => {
      try {
        const snap = await getDoc(doc(db, "compras", "lista_compras"));
        if (snap.exists()) {
          const data = snap.data();
          setCompras(data.items || []);
        } else {
          setCompras([]);
        }
      } catch (error) {
        console.error("Error cargando compras desde Firebase:", error);
        setCompras([]);
      }
    };
    cargar();
  }, []);

  // Cargar historial de gastos desde Firebase
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
      } catch (error) {
        console.error("Error cargando gastos desde Firebase:", error);
      }
    };
    cargarGastos();
  }, []);

  const totalCompra = compras.reduce(
    (acc, c) => acc + (c.costoPaquete || 0),
    0,
  );

  const unidadLabel = (u) => {
    if (u === "g") return "gramos";
    if (u === "ml") return "mililitros";
    return "unidades";
  };

  const handleEliminar = (id) => {
    const nuevasCompras = compras.filter((c) => c.id !== id);
    setCompras(nuevasCompras);
    setDoc(doc(db, "compras", "lista_compras"), {
      items: nuevasCompras,
      updatedAt: new Date(),
    }).catch((err) => console.error(err));
  };

  const abrirModal = (item) => {
    setModalItem(item);
    setModalCantidad(String(item.cantidadComprar));
    setModalCosto(String(item.costoPaquete ?? ""));
  };

  const cerrarModal = () => {
    setModalItem(null);
    setModalCantidad("");
    setModalCosto("");
  };

  const handleEliminarGasto = (id) => {
    const actualizados = gastos.filter((g) => g.id !== id);
    setGastos(actualizados);
    deleteDoc(doc(db, "gastos", id)).catch((err) =>
      console.error("Error eliminando gasto:", err),
    );
  };

  const confirmarComprado = async () => {
    if (!modalItem) return;
    const cantidadComprada = parseFloat(modalCantidad) || 0;
    const costoFinal = parseFloat(modalCosto) || 0;
    const costoPorUnidad =
      cantidadComprada > 0 ? costoFinal / cantidadComprada : 0;

    try {
      // Guardar gasto
      const nuevoGasto = {
        id: Date.now().toString(),
        ingrediente: modalItem.nombre,
        cantidad: cantidadComprada,
        unidad: modalItem.unidad,
        costo: costoFinal,
        fecha: new Date().toISOString(),
      };
      setGastos((prev) => [...prev, nuevoGasto]);
      setDoc(doc(db, "gastos", nuevoGasto.id), {
        ingrediente: nuevoGasto.ingrediente,
        cantidad: nuevoGasto.cantidad,
        unidad: nuevoGasto.unidad,
        costo: nuevoGasto.costo,
        fecha: new Date(),
      }).catch((err) => console.error("Error guardando gasto:", err));

      // Actualizar stock en bodega desde Firebase
      let ingredientesActualizados = null;
      try {
        const snap = await getDoc(doc(db, "bodega", "mi_bodega"));
        if (snap.exists()) {
          const data = snap.data();
          ingredientesActualizados = (data.ingredientes || []).map((i) => {
            if (i.id === modalItem.id) {
              const nuevaCantidad = (i.cantidad || 0) + cantidadComprada;
              return {
                ...i,
                cantidad: nuevaCantidad,
                costoPorUnidad:
                  costoPorUnidad > 0 ? costoPorUnidad : i.costoPorUnidad,
              };
            }
            return i;
          });
        }
      } catch (error) {
        console.error("Error leyendo bodega desde Firebase:", error);
      }

      if (ingredientesActualizados) {
        setDoc(doc(db, "bodega", "mi_bodega"), {
          ingredientes: ingredientesActualizados,
          updatedAt: new Date(),
        }).catch((err) => console.error("Error actualizando bodega:", err));
      }

      // Eliminar de la lista de compras
      const nuevasCompras = compras.filter((c) => c.id !== modalItem.id);
      setCompras(nuevasCompras);
      setDoc(doc(db, "compras", "lista_compras"), {
        items: nuevasCompras,
        updatedAt: new Date(),
      }).catch((err) => console.error(err));
    } catch (error) {
      console.error(error);
    }
    cerrarModal();
  };

  return (
    <div className="compras">
      <header className="compras-header">
        <h1>🛒 Lista de Compras</h1>
        <p className="subtitle">Ingredientes con stock bajo (≤ 25%)</p>
      </header>

      <div className="compras-stats">
        <div className="compras-stat">
          <div className="stat-icon">📋</div>
          <div className="stat-info">
            <span className="stat-label">Items por comprar</span>
            <span className="stat-value">{compras.length}</span>
          </div>
        </div>
        <div className="compras-stat">
          <div className="stat-icon">💵</div>
          <div className="stat-info">
            <span className="stat-label">Costo total paquetes</span>
            <span className="stat-value">${totalCompra.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {compras.length === 0 ? (
        <div className="compras-empty">
          <div className="empty-icon">✅</div>
          <p>No hay ingredientes por comprar. ¡Todo el stock está bien!</p>
        </div>
      ) : (
        <div className="compras-list-card">
          <table className="compras-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Ingrediente</th>
                <th>Stock actual</th>
                <th>Cantidad a comprar</th>
                <th>Costo/Unidad</th>
                <th>Costo paquete</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {compras.map((c, i) => (
                <tr key={c.id}>
                  <td data-label="#">{i + 1}</td>
                  <td data-label="Ingrediente" className="td-name">
                    {c.nombre}
                  </td>
                  <td data-label="Stock actual" className="td-low">
                    {c.cantidadActual} {c.unidad} de {c.cantidadOriginal}{" "}
                    {c.unidad}
                  </td>
                  <td data-label="Cantidad a comprar" className="td-qty">
                    {c.cantidadComprar} {unidadLabel(c.unidad)}
                  </td>
                  <td data-label="Costo/Unidad" className="td-cost">
                    ${c.costoPorUnidad?.toFixed(2)}/{c.unidad}
                  </td>
                  <td data-label="Costo paquete" className="td-total">
                    ${c.costoPaquete?.toFixed(2)}
                  </td>
                  <td data-label="Acción">
                    <button
                      className="btn-comprado"
                      onClick={() => abrirModal(c)}
                    >
                      ✅ Comprado
                    </button>
                    <button
                      className="btn-eliminar-compra"
                      onClick={() => handleEliminar(c.id)}
                      title="Eliminar de la lista"
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="6" className="total-label">
                  Total de compra
                </td>
                <td className="total-value">${totalCompra.toFixed(2)}</td>
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

        {(() => {
          const gastosFiltrados = gastos.filter((g) => {
            if (!g.fecha) return false;
            const fechaStr =
              typeof g.fecha === "string"
                ? g.fecha
                : new Date(g.fecha).toISOString();
            if (filtro === "dia") {
              return fechaStr.slice(0, 10) === fechaFiltro;
            }
            return fechaStr.slice(0, 7) === mesFiltro;
          });
          const totalGastos = gastosFiltrados.reduce(
            (acc, g) => acc + (g.costo || 0),
            0,
          );
          return (
            <>
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
                    {gastosFiltrados
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
            </>
          );
        })()}
      </div>

      {/* ── Modal confirmar compra ── */}
      {modalItem && (
        <div className="modal-overlay" onClick={cerrarModal}>
          <div className="modal-compra" onClick={(e) => e.stopPropagation()}>
            <h3>✅ Confirmar compra</h3>
            <p className="modal-ingrediente">{modalItem.nombre}</p>
            <div className="modal-field">
              <label>Cantidad comprada ({modalItem.unidad})</label>
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
              <span>Costo por {modalItem.unidad}:</span>
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
