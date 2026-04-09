import { useState, useMemo, useEffect } from "react";
import "./Bodega.css";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../firbase/Firebase";
const UNIDADES = [
  { value: "g", label: "Gramos (g)" },
  { value: "ml", label: "Mililitros (ml)" },
  { value: "ud", label: "Unidades (ud)" },
];

function Bodega() {
  const [ingredientes, setIngredientes] = useState(() => {
    // Cargar desde localStorage si existe
    try {
      const data = localStorage.getItem("bodega_ingredientes");
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  });
  // Guardar en localStorage cada vez que ingredientes cambia

  useEffect(() => {
    const guardarDatos = async () => {
      try {
        localStorage.setItem(
          "bodega_ingredientes",
          JSON.stringify(ingredientes),
        );

        await setDoc(doc(db, "bodega", "mi_bodega"), {
          ingredientes: ingredientes,
          updatedAt: new Date(),
        });
      } catch (error) {
        console.error(error);
      }
    };

    if (ingredientes.length > 0) {
      guardarDatos();
    }
  }, [ingredientes]);
  /**/

  const [busqueda, setBusqueda] = useState("");

  // Form state
  const [nombre, setNombre] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [costoTotal2, setCostoTotal2] = useState("");
  const [unidad, setUnidad] = useState("g");
  const [saving, setSaving] = useState(false);

  // Costo por unidad calculado automáticamente
  // Costo por unidad calculado automáticamente, mínimo $0.01 y 2 decimales
  const costoPorUnidadCalcRaw =
    cantidad && costoTotal2 && parseFloat(cantidad) > 0
      ? parseFloat(costoTotal2) / parseFloat(cantidad)
      : 0;
  const costoPorUnidadCalc =
    costoPorUnidadCalcRaw > 0 && costoPorUnidadCalcRaw < 0.01
      ? 0.01
      : parseFloat(costoPorUnidadCalcRaw.toFixed(2));

  // Filtrado y ordenado por nombre
  const filtered = useMemo(() => {
    let lista = ingredientes;
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      lista = lista.filter((i) => i.nombre.toLowerCase().includes(q));
    }
    // Ordenar por nombre (alfabético, insensible a mayúsculas)
    return [...lista].sort((a, b) =>
      a.nombre.localeCompare(b.nombre, undefined, { sensitivity: "base" }),
    );
  }, [ingredientes, busqueda]);

  // Stats
  const totalIngredientes = ingredientes.length;
  // Sumar el campo costoTotal de cada ingrediente
  const costoTotal = ingredientes.reduce(
    (acc, i) => acc + (i.costoTotal || 0),
    0,
  );

  // Agregar ingrediente (local)
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!nombre.trim() || !cantidad || !costoTotal2) return;
    setSaving(true);
    const cantNum = parseFloat(cantidad);
    const costoTotalNum = parseFloat(costoTotal2);
    let costoPorUnidad = cantNum > 0 ? costoTotalNum / cantNum : 0;
    // Redondear a 2 decimales y mínimo $0.01
    costoPorUnidad =
      costoPorUnidad > 0 && costoPorUnidad < 0.01
        ? 0.01
        : parseFloat(costoPorUnidad.toFixed(2));
    const nuevo = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      nombre: nombre.trim(),
      cantidad: cantNum,
      costoTotal: costoTotalNum,
      costoPorUnidad,
      unidad,
      createdAt: new Date().toISOString(),
    };
    setIngredientes((ings) => [...ings, nuevo]);
    setNombre("");
    setCantidad("");
    setCostoTotal2("");
    setUnidad("g");
    setSaving(false);
  };

  // Eliminar ingrediente (local)
  const handleDelete = (id) => {
    setIngredientes((ings) => ings.filter((i) => i.id !== id));
  };

  // Edición de ingredientes
  const [editId, setEditId] = useState(null);
  const [editNombre, setEditNombre] = useState("");
  const [editCantidad, setEditCantidad] = useState("");
  const [editCostoTotal, setEditCostoTotal] = useState("");
  const [editUnidad, setEditUnidad] = useState("g");
  const [editSaving, setEditSaving] = useState(false);

  // Cálculo automático de costo por unidad en edición
  const editCostoPorUnidadRaw =
    editCantidad && editCostoTotal && parseFloat(editCantidad) > 0
      ? parseFloat(editCostoTotal) / parseFloat(editCantidad)
      : 0;
  const editCostoPorUnidad =
    editCostoPorUnidadRaw > 0 && editCostoPorUnidadRaw < 0.01
      ? 0.01
      : parseFloat(editCostoPorUnidadRaw.toFixed(2));

  const handleEdit = (ing) => {
    setEditId(ing.id);
    setEditNombre(ing.nombre);
    setEditCantidad(ing.cantidad.toString());
    setEditCostoTotal(ing.costoTotal.toString());
    setEditUnidad(ing.unidad);
  };

  const handleEditCancel = () => {
    setEditId(null);
    setEditNombre("");
    setEditCantidad("");
    setEditCostoTotal("");
    setEditUnidad("g");
    setEditSaving(false);
  };

  const handleEditSave = (e) => {
    e.preventDefault();
    if (!editNombre.trim() || !editCantidad || !editCostoTotal) return;
    setEditSaving(true);
    const cantNum = parseFloat(editCantidad);
    const costoTotalNum = parseFloat(editCostoTotal);
    let costoPorUnidad = cantNum > 0 ? costoTotalNum / cantNum : 0;
    costoPorUnidad =
      costoPorUnidad > 0 && costoPorUnidad < 0.01
        ? 0.01
        : parseFloat(costoPorUnidad.toFixed(2));
    setIngredientes((ings) =>
      ings.map((i) =>
        i.id === editId
          ? {
              ...i,
              nombre: editNombre.trim(),
              cantidad: cantNum,
              costoTotal: costoTotalNum,
              costoPorUnidad,
              unidad: editUnidad,
            }
          : i,
      ),
    );
    handleEditCancel();
  };

  const costoLabel = (u) => {
    if (u === "g") return "$/g";
    if (u === "ml") return "$/ml";
    return "$/ud";
  };

  return (
    <div className="bodega">
      <header className="bodega-header">
        <h1>📦 Bodega</h1>
        <p className="subtitle">Gestión de ingredientes e inventario</p>
      </header>

      {/* ── Stats ── */}
      <div className="bodega-stats">
        <div className="bodega-stat">
          <div className="stat-icon">🧂</div>
          <div className="stat-info">
            <span className="stat-label">Ingredientes</span>
            <span className="stat-value">{totalIngredientes}</span>
          </div>
        </div>
        <div className="bodega-stat">
          <div className="stat-icon">💰</div>
          <div className="stat-info">
            <span className="stat-label">Costo Inventario</span>
            <span className="stat-value">${costoTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="bodega-content">
        {/* ── Formulario ── */}
        <div className="bodega-form-card">
          <h2>
            <span>➕</span> Agregar Ingrediente
          </h2>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Nombre</label>
              <input
                type="text"
                placeholder="Ej: Harina de trigo"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Unidad de medida</label>
              <select
                value={unidad}
                onChange={(e) => setUnidad(e.target.value)}
              >
                {UNIDADES.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Cantidad ({unidad})</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="500"
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Costo total del paquete ($)</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="12.50"
                  value={costoTotal2}
                  onChange={(e) => setCostoTotal2(e.target.value)}
                  required
                />
              </div>
            </div>

            {costoPorUnidadCalc > 0 && (
              <div className="cost-preview">
                Costo calculado:{" "}
                <strong>
                  ${costoPorUnidadCalc.toFixed(2)}
                  {costoPorUnidadCalc === 0.01 && " (mínimo)"}
                </strong>{" "}
                por{" "}
                {unidad === "g"
                  ? "gramo"
                  : unidad === "ml"
                    ? "mililitro"
                    : "unidad"}
              </div>
            )}

            <button
              type="submit"
              className="btn-add-ingredient"
              disabled={saving || !nombre.trim() || !cantidad || !costoTotal2}
            >
              {saving ? "⏳ Guardando..." : "Agregar ingrediente"}
            </button>
          </form>
        </div>

        {/* ── Lista ── */}
        <div className="bodega-list-card">
          <div className="bodega-list-header">
            <h2>
              <span>🗂️</span> Ingredientes
              <span className="ingredient-count">{filtered.length}</span>
            </h2>
            <input
              className="bodega-search"
              type="text"
              placeholder="🔍 Buscar ingrediente..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>

          {filtered.length === 0 ? (
            <div className="bodega-empty">
              <div className="empty-icon">🧺</div>
              <p>
                {busqueda
                  ? "No se encontraron ingredientes"
                  : "Aún no hay ingredientes. ¡Agrega el primero!"}
              </p>
            </div>
          ) : (
            <table className="ingredient-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nombre</th>
                  <th>Cantidad</th>
                  <th>Unidad</th>
                  <th>Costo/Unidad</th>
                  <th>Costo paquete</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ing, i) =>
                  editId === ing.id ? (
                    <tr key={ing.id} className="editing-row">
                      <td data-label="#">{i + 1}</td>
                      <td data-label="Nombre" className="td-name">
                        <input
                          type="text"
                          value={editNombre}
                          onChange={(e) => setEditNombre(e.target.value)}
                          required
                        />
                      </td>
                      <td data-label="Cantidad" className="td-qty">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={editCantidad}
                          onChange={(e) => setEditCantidad(e.target.value)}
                          required
                        />
                      </td>
                      <td data-label="Unidad">
                        <select
                          value={editUnidad}
                          onChange={(e) => setEditUnidad(e.target.value)}
                        >
                          {UNIDADES.map((u) => (
                            <option key={u.value} value={u.value}>
                              {u.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td data-label="Costo/Unidad" className="td-cost">
                        $
                        {editCostoPorUnidad !== undefined
                          ? editCostoPorUnidad < 0.01 && editCostoPorUnidad > 0
                            ? "0.01"
                            : editCostoPorUnidad.toFixed(2)
                          : "0.00"}{" "}
                        {costoLabel(editUnidad)}
                        {editCostoPorUnidad !== undefined &&
                          editCostoPorUnidad === 0.01 &&
                          " (mínimo)"}
                      </td>
                      <td data-label="Costo paquete" className="td-cost">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={editCostoTotal}
                          onChange={(e) => setEditCostoTotal(e.target.value)}
                          required
                        />
                      </td>
                      <td data-label="Acciones">
                        <button
                          className="btn-save"
                          title="Guardar"
                          onClick={handleEditSave}
                          disabled={
                            editSaving ||
                            !editNombre.trim() ||
                            !editCantidad ||
                            !editCostoTotal
                          }
                        >
                          💾
                        </button>
                        <button
                          className="btn-cancel"
                          title="Cancelar"
                          onClick={handleEditCancel}
                        >
                          ❌
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={ing.id}>
                      <td data-label="#">{i + 1}</td>
                      <td data-label="Nombre" className="td-name">
                        {ing.nombre}
                      </td>
                      <td data-label="Cantidad" className="td-qty">
                        {ing.cantidad}
                      </td>
                      <td data-label="Unidad">
                        <span className={`unit-badge ${ing.unidad}`}>
                          {ing.unidad}
                        </span>
                      </td>
                      <td data-label="Costo/Unidad" className="td-cost">
                        $
                        {ing.costoPorUnidad !== undefined
                          ? ing.costoPorUnidad < 0.01 && ing.costoPorUnidad > 0
                            ? "0.01"
                            : ing.costoPorUnidad.toFixed(2)
                          : "0.00"}{" "}
                        {costoLabel(ing.unidad)}
                        {ing.costoPorUnidad !== undefined &&
                          ing.costoPorUnidad === 0.01 &&
                          " (mínimo)"}
                      </td>
                      <td data-label="Costo paquete" className="td-cost">
                        ${ing.costoTotal?.toFixed(2)}
                      </td>
                      <td data-label="Acciones">
                        <button
                          className="btn-edit"
                          title="Editar"
                          onClick={() => handleEdit(ing)}
                        >
                          ✏️
                        </button>
                        <button
                          className="btn-delete"
                          title="Eliminar"
                          onClick={() => handleDelete(ing.id)}
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default Bodega;
