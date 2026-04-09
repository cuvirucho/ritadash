import { useState, useEffect } from "react";
import "./Compras.css";
import {
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  getDocs,
} from "firebase/firestore";
import { db } from "../firbase/Firebase";

function Compras() {
  const [compras, setCompras] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [filtro, setFiltro] = useState("mes"); // "dia" o "mes"
  const [fechaFiltro, setFechaFiltro] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [mesFiltro, setMesFiltro] = useState(
    new Date().toISOString().slice(0, 7),
  );

  useEffect(() => {
    const cargar = () => {
      try {
        const data = localStorage.getItem("lista_compras");
        setCompras(data ? JSON.parse(data) : []);
      } catch {
        setCompras([]);
      }
    };
    cargar();
    // Escuchar cambios en localStorage desde otras pestañas/componentes
    window.addEventListener("storage", cargar);
    // Revisar cada 2 segundos por cambios locales
    const interval = setInterval(cargar, 2000);
    return () => {
      window.removeEventListener("storage", cargar);
      clearInterval(interval);
    };
  }, []);

  // Si no hay datos en localStorage, traerlos de Firebase
  useEffect(() => {
    const cargarDesdeFirebase = async () => {
      if (compras.length > 0) return;
      try {
        const snap = await getDoc(doc(db, "compras", "lista_compras"));
        if (snap.exists()) {
          const data = snap.data();
          if (data.items && data.items.length > 0) {
            setCompras(data.items);
            localStorage.setItem("lista_compras", JSON.stringify(data.items));
          }
        }
      } catch (error) {
        console.error("Error cargando compras desde Firebase:", error);
      }
    };
    cargarDesdeFirebase();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cargar historial de gastos
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
        // ignorar error de parse
      }
      // Fallback: traer de Firebase
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

  const handleComprado = (id, cantidadOriginal) => {
    try {
      // Guardar el gasto del item comprado
      const itemComprado = compras.find((c) => c.id === id);
      if (itemComprado) {
        const nuevoGasto = {
          id: Date.now().toString(),
          ingrediente: itemComprado.nombre,
          cantidad: itemComprado.cantidadComprar,
          unidad: itemComprado.unidad,
          costo: itemComprado.costoPaquete || 0,
          fecha: new Date().toISOString(),
        };
        setGastos((prev) => {
          const updated = [...prev, nuevoGasto];
          localStorage.setItem("historial_gastos", JSON.stringify(updated));
          return updated;
        });
        addDoc(collection(db, "gastos"), {
          ingrediente: nuevoGasto.ingrediente,
          cantidad: nuevoGasto.cantidad,
          unidad: nuevoGasto.unidad,
          costo: nuevoGasto.costo,
          fecha: new Date(),
        }).catch((err) => console.error("Error guardando gasto:", err));
      }

      const data = localStorage.getItem("bodega_ingredientes");
      if (data) {
        const ingredientes = JSON.parse(data);
        const actualizados = ingredientes.map((i) =>
          i.id === id ? { ...i, cantidad: cantidadOriginal } : i,
        );
        localStorage.setItem(
          "bodega_ingredientes",
          JSON.stringify(actualizados),
        );
        const nuevasCompras = actualizados
          .filter(
            (i) =>
              i.cantidadOriginal && i.cantidad <= i.cantidadOriginal * 0.25,
          )
          .map((i) => ({
            id: i.id,
            nombre: i.nombre,
            cantidadActual: i.cantidad,
            cantidadOriginal: i.cantidadOriginal,
            cantidadComprar: i.cantidadOriginal - i.cantidad,
            unidad: i.unidad,
            costoPorUnidad: i.costoPorUnidad,
            costoPaquete: i.costoTotal,
          }));
        localStorage.setItem("lista_compras", JSON.stringify(nuevasCompras));
        setCompras(nuevasCompras);

        setDoc(doc(db, "compras", "lista_compras"), {
          items: nuevasCompras,
          updatedAt: new Date(),
        }).catch((err) => console.error(err));
      }
    } catch (error) {
      console.error(error);
    }
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
                      onClick={() => handleComprado(c.id, c.cantidadOriginal)}
                    >
                      ✅ Comprado
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
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="3" className="total-label">
                        Total del período
                      </td>
                      <td colSpan="2" className="total-value">
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
    </div>
  );
}

export default Compras;
