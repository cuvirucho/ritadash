import { useState, useMemo, useEffect, useCallback } from "react";
import "./Bodega.css";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { db } from "../firbase/Firebase";

const UNIDADES = [
  { value: "g", label: "Gramos (g)" },
  { value: "ml", label: "Mililitros (ml)" },
  { value: "ud", label: "Unidades (ud)" },
];

// Formatea el costo por unidad mostrando todos los decimales relevantes
const formatCostoPorUnidad = (val) => {
  if (val === undefined || val === null || val === 0) return "0.00";
  if (val >= 1) return val.toFixed(2);
  if (val >= 0.01) return val.toFixed(4);
  return val.toFixed(8);
};

function Bodega() {
  const [ingredientes, setIngredientes] = useState([]);

  // Cargar SIEMPRE desde Firebase al iniciar
  useEffect(() => {
    const cargarDesdeFirebase = async () => {
      try {
        const snap = await getDoc(doc(db, "bodega", "mi_bodega"));
        if (snap.exists()) {
          const data = snap.data();
          if (data.ingredientes && data.ingredientes.length > 0) {
            setIngredientes(data.ingredientes);
            // Opcional: cache local
            localStorage.setItem(
              "bodega_ingredientes",
              JSON.stringify(data.ingredientes),
            );
          } else {
            setIngredientes([]);
            localStorage.removeItem("bodega_ingredientes");
          }
        } else {
          setIngredientes([]);
          localStorage.removeItem("bodega_ingredientes");
        }
      } catch (error) {
        console.error("Error cargando desde Firebase:", error);
        setIngredientes([]);
      }
    };
    cargarDesdeFirebase();
    // Solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guardar en localStorage y Firebase
  const guardarEnFirebase = useCallback(async (listaIngredientes) => {
    try {
      localStorage.setItem(
        "bodega_ingredientes",
        JSON.stringify(listaIngredientes),
      );
      await setDoc(doc(db, "bodega", "mi_bodega"), {
        ingredientes: listaIngredientes,
        updatedAt: new Date(),
      });
      console.log(
        "✅ Guardado en Firebase:",
        listaIngredientes.length,
        "ingredientes",
      );
    } catch (error) {
      console.error("❌ Error guardando en Firebase:", error);
    }
  }, []);

  const [busqueda, setBusqueda] = useState("");
  const [sortBy, setSortBy] = useState("nombre");
  const [sortDir, setSortDir] = useState("asc");
  const [comprasIds, setComprasIds] = useState([]);

  // Cargar IDs de compras desde Firebase al montar
  useEffect(() => {
    getDoc(doc(db, "compras", "lista_compras"))
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setComprasIds((data.items || []).map((c) => c.id));
        }
      })
      .catch((err) => console.error("Error cargando comprasIds:", err));
  }, []);

  // Función para verificar y actualizar lista de compras
  // Solo AGREGA items nuevos con stock bajo; nunca elimina los existentes
  const actualizarListaCompras = useCallback(async (listaIngredientes) => {
    try {
      const snap = await getDoc(doc(db, "compras", "lista_compras"));
      const existing = snap.exists() ? (snap.data().items || []) : [];
      const existingIds = new Set(existing.map((c) => c.id));

      setComprasIds(existing.map((c) => c.id));

      const nuevosItems = listaIngredientes
        .filter((i) => {
          if (existingIds.has(i.id)) return false;
          const cantMax = i.cantidadMaxima;
          const cantMin = i.cantidadMinima ?? (cantMax ? cantMax * 0.25 : 0);
          return cantMax && i.cantidad <= cantMin;
        })
        .map((i) => ({
          id: i.id,
          nombre: i.nombre,
          cantidadActual: i.cantidad ?? 0,
          cantidadComprar: i.cantidadMinima ?? 0,
          unidad: i.unidad ?? "ud",
          costoPorUnidad: i.costoPorUnidad ?? 0,
          costoPaquete: i.costoTotal ?? 0,
        }));

      if (nuevosItems.length === 0) return;

      const updated = [...existing, ...nuevosItems];
      setComprasIds(updated.map((c) => c.id));
      setDoc(doc(db, "compras", "lista_compras"), {
        items: updated,
        updatedAt: new Date(),
      }).catch((error) => console.error(error));
    } catch (err) {
      console.error("Error actualizando lista de compras:", err);
    }
  }, []);

  // Actualizar lista de compras cuando cambian los ingredientes
  useEffect(() => {
    actualizarListaCompras(ingredientes);
  }, [ingredientes, actualizarListaCompras]);

  // Form state
  const [nombre, setNombre] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [costoTotal2, setCostoTotal2] = useState("");
  const [unidad, setUnidad] = useState("g");
  const [cantidadMinima, setCantidadMinima] = useState("");
  const [cantidadMaxima, setCantidadMaxima] = useState("");
  const [saving, setSaving] = useState(false);

  // Costo por unidad calculado automáticamente (valor real, sin mínimo)
  const costoPorUnidadCalc =
    cantidad && costoTotal2 && parseFloat(cantidad) > 0
      ? parseFloat(costoTotal2) / parseFloat(cantidad)
      : 0;

  const handleSort = (col) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
  };

  const sortIcon = (col) =>
    sortBy !== col ? " ↕" : sortDir === "asc" ? " ↑" : " ↓";

  // Filtrado y ordenado
  const filtered = useMemo(() => {
    let lista = ingredientes;
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      lista = lista.filter((i) => i.nombre.toLowerCase().includes(q));
    }
    return [...lista].sort((a, b) => {
      if (sortBy === "nombre") {
        const cmp = a.nombre.localeCompare(b.nombre, undefined, {
          sensitivity: "base",
        });
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortBy === "costoPorUnidad") {
        const cmp = (a.costoPorUnidad ?? 0) - (b.costoPorUnidad ?? 0);
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortBy === "unidad") {
        const cmp = (a.unidad ?? "").localeCompare(b.unidad ?? "");
        return sortDir === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }, [ingredientes, busqueda, sortBy, sortDir]);

  // Stats
  const totalIngredientes = ingredientes.length;
  // Sumar el campo costoTotal de cada ingrediente
  const costoTotal = ingredientes.reduce(
    (acc, i) => acc + (i.costoTotal || 0),
    0,
  );

  // Agregar ingrediente
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!nombre.trim() || !cantidad || !costoTotal2) return;
    setSaving(true);
    const cantNum = parseFloat(cantidad);
    const costoTotalNum = parseFloat(costoTotal2);
    const costoPorUnidad = cantNum > 0 ? costoTotalNum / cantNum : 0;
    const cantMinNum =
      cantidadMinima !== "" ? parseFloat(cantidadMinima) : null;
    const cantMaxNum =
      cantidadMaxima !== "" ? parseFloat(cantidadMaxima) : cantNum;
    const nuevo = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      nombre: nombre.trim(),
      cantidad: cantNum,
      cantidadExistente: cantNum,
      cantidadUltimaCompra: cantNum,
      cantidadMinima: cantMinNum,
      cantidadMaxima: cantMaxNum,
      costoTotal: costoTotalNum,
      costoPorUnidad,
      unidad,
      createdAt: new Date().toISOString(),
    };
    const nuevos = [...ingredientes, nuevo];
    setIngredientes(nuevos);
    await guardarEnFirebase(nuevos);
    setNombre("");
    setCantidad("");
    setCostoTotal2("");
    setUnidad("g");
    setCantidadMinima("");
    setCantidadMaxima("");
    setSaving(false);
  };

  // Eliminar ingrediente
  const handleDelete = async (id) => {
    const nuevos = ingredientes.filter((i) => i.id !== id);
    setIngredientes(nuevos);
    await guardarEnFirebase(nuevos);
  };

  // Enviar manualmente a compras
  const handleEnviarACompras = useCallback(async (ing) => {
    const cantMax = ing.cantidadMaxima;
    const compraItem = {
      id: ing.id,
      nombre: ing.nombre,
      cantidadActual: ing.cantidad ?? 0,
      cantidadComprar:
        (cantMax ?? ing.cantidadOriginal ?? 0) - (ing.cantidad ?? 0),
      unidad: ing.unidad ?? "ud",
      costoPorUnidad: ing.costoPorUnidad ?? 0,
      costoPaquete: ing.costoTotal ?? 0,
    };
    try {
      const snap = await getDoc(doc(db, "compras", "lista_compras"));
      const existing = snap.exists() ? (snap.data().items || []) : [];
      const idx = existing.findIndex((x) => x.id === ing.id);
      const updated =
        idx >= 0
          ? existing.map((x, k) => (k === idx ? compraItem : x))
          : [...existing, compraItem];
      setComprasIds(updated.map((c) => c.id));
      setDoc(doc(db, "compras", "lista_compras"), {
        items: updated,
        updatedAt: new Date(),
      }).catch(console.error);
    } catch (err) {
      console.error("Error enviando a compras:", err);
    }
  }, []);

  // Consumir stock
  const handleConsumir = async (id, cantidadConsumir) => {
    const cant = parseFloat(cantidadConsumir);
    if (!cant || cant <= 0) return;
    const nuevos = ingredientes.map((i) => {
      if (i.id !== id) return i;
      return { ...i, cantidad: Math.max(0, i.cantidad - cant) };
    });
    setIngredientes(nuevos);
    await guardarEnFirebase(nuevos);
  };

  // Edición de ingredientes
  const [editId, setEditId] = useState(null);
  const [editNombre, setEditNombre] = useState("");
  const [cantidadexite, setCantidadexite] = useState(0);
  const [editCantidad, setEditCantidad] = useState("");
  const [editCostoTotal, setEditCostoTotal] = useState("");
  const [editUnidad, setEditUnidad] = useState("g");
  const [editCantidadMinima, setEditCantidadMinima] = useState("");
  const [editCantidadMaxima, setEditCantidadMaxima] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Cálculo automático de costo por unidad en edición (valor real)
  const editCostoPorUnidad =
    editCantidad && editCostoTotal && parseFloat(editCantidad) > 0
      ? parseFloat(editCostoTotal) / parseFloat(editCantidad)
      : 0;

  const handleEdit = (ing) => {
    setEditId(ing.id);
    setEditNombre(ing.nombre);
    setCantidadexite(ing.cantidad.toString());
    setEditCantidad("");
    setEditCostoTotal(ing.costoTotal.toString());
    setEditUnidad(ing.unidad);
    setEditCantidadMinima(
      ing.cantidadMinima !== undefined ? ing.cantidadMinima.toString() : "",
    );
    setEditCantidadMaxima(
      ing.cantidadMaxima !== undefined ? ing.cantidadMaxima.toString() : "",
    );
  };

  const handleEditCancel = () => {
    setEditId(null);
    setEditNombre("");
    setCantidadexite("");
    setEditCantidad("");
    setEditCostoTotal("");
    setEditUnidad("g");
    setEditCantidadMinima("");
    setEditCantidadMaxima("");
    setEditSaving(false);
  };

  const handleEditSave = async (e) => {
    e.preventDefault();
    if (!editNombre.trim() || !editCostoTotal) return;
    setEditSaving(true);
    const cantComprada = editCantidad !== "" ? parseFloat(editCantidad) : 0;
    const cantExistente = cantidadexite !== "" ? parseFloat(cantidadexite) : 0;
    const cantTotal = cantExistente + cantComprada;
    const costoTotalNum = parseFloat(editCostoTotal);
    const cantMinNum =
      editCantidadMinima !== "" ? parseFloat(editCantidadMinima) : null;
    const cantMaxNum =
      editCantidadMaxima !== "" ? parseFloat(editCantidadMaxima) : null;
    const ingActualizados = ingredientes.map((i) =>
      i.id === editId
        ? {
            ...i,
            nombre: editNombre.trim(),
            cantidad: cantTotal,
            cantidadExistente: cantExistente,
            cantidadUltimaCompra:
              cantComprada > 0 ? cantComprada : i.cantidadUltimaCompra,
            cantidadMinima: cantMinNum,
            cantidadMaxima: cantMaxNum ?? i.cantidadMaxima ?? cantTotal,
            // Solo actualiza costo si se ingresó cantidad comprada
            costoTotal: cantComprada > 0 ? costoTotalNum : i.costoTotal,
            costoPorUnidad:
              cantComprada > 0
                ? costoTotalNum / cantComprada
                : i.costoPorUnidad,
            unidad: editUnidad,
          }
        : i,
    );
    setIngredientes(ingActualizados);
    await guardarEnFirebase(ingActualizados);
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

            <div className="form-row">
              <div className="form-group">
                <label>Cantidad mínima ({unidad})</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="Alerta de stock bajo"
                  value={cantidadMinima}
                  onChange={(e) => setCantidadMinima(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Cantidad máxima ({unidad})</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="Stock máximo"
                  value={cantidadMaxima}
                  onChange={(e) => setCantidadMaxima(e.target.value)}
                />
              </div>
            </div>

            {costoPorUnidadCalc > 0 && (
              <div className="cost-preview">
                Costo calculado:{" "}
                <strong>${formatCostoPorUnidad(costoPorUnidadCalc)}</strong> por{" "}
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

          {/* ── Sort bar (siempre visible, esencial en móvil) ── */}
          <div className="sort-bar">
            <span className="sort-bar-label">Ordenar:</span>
            {[
              { key: "nombre", label: "Nombre" },
              { key: "unidad", label: "Tipo" },
              { key: "costoPorUnidad", label: "Costo" },
            ].map(({ key, label }) => (
              <button
                key={key}
                className={`sort-btn${sortBy === key ? " sort-btn-active" : ""}`}
                onClick={() => handleSort(key)}
              >
                {label}
                {sortBy === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
              </button>
            ))}
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
                  <th
                    className="sortable-th"
                    onClick={() => handleSort("nombre")}
                    style={{ cursor: "pointer" }}
                  >
                    Nombre{sortIcon("nombre")}
                  </th>
                  <th>Cantidad existente</th>
                  <th
                    className="sortable-th"
                    onClick={() => handleSort("unidad")}
                    style={{ cursor: "pointer" }}
                  >
                    Tipo{sortIcon("unidad")}
                  </th>
                  <th
                    className="sortable-th"
                    onClick={() => handleSort("costoPorUnidad")}
                    style={{ cursor: "pointer" }}
                  >
                    Costo/Unidad{sortIcon("costoPorUnidad")}
                  </th>
                  <th>Costo paquete</th>
                  <th>Stock</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ing, i) => {
                  const cantMax = ing.cantidadMaxima;
                  const cantMin =
                    ing.cantidadMinima ??
                    (cantMax ? cantMax * 0.25 : undefined);
                  // pct: 0% = en el mínimo, 100% = en el máximo
                  const pct =
                    cantMax != null && cantMin != null && cantMax > cantMin
                      ? Math.max(
                          0,
                          Math.min(
                            100,
                            ((ing.cantidad - cantMin) / (cantMax - cantMin)) *
                              100,
                          ),
                        )
                      : cantMax && cantMax > 0
                        ? Math.max(
                            0,
                            Math.min(100, (ing.cantidad / cantMax) * 100),
                          )
                        : null;
                  const isLow =
                    cantMin !== undefined && ing.cantidad <= cantMin;
                  const isUrgent = ing.cantidad <= 0;
                  const stockClass =
                    pct === null
                      ? "stock-ok"
                      : pct <= 15
                        ? "stock-low"
                        : pct <= 40
                          ? "stock-mid"
                          : "stock-ok";
                  return (
                    <tr
                      key={ing.id}
                      className={editId === ing.id ? "row-editing-active" : ""}
                    >
                      <td data-label="#">{i + 1}</td>
                      <td data-label="Nombre" className="td-name">
                        <span className="td-nombre-text">{ing.nombre}</span>
                        {comprasIds.includes(ing.id) && (
                          <span className="en-compras-badge">
                            🛒 en compras
                          </span>
                        )}
                      </td>
                      <td data-label="Cantidad existente" className="td-qty">
                        {ing.cantidad}
                      </td>
                      <td data-label="Tipo">
                        <span className={`unit-badge ${ing.unidad}`}>
                          {ing.unidad}
                        </span>
                      </td>
                      <td data-label="Costo/Unidad" className="td-cost">
                        ${formatCostoPorUnidad(ing.costoPorUnidad)}{" "}
                        {costoLabel(ing.unidad)}
                      </td>
                      <td data-label="Costo paquete" className="td-cost">
                        ${ing.costoTotal?.toFixed(2)}
                      </td>
                      <td data-label="Stock">
                        {cantMax ? (
                          <div className="stock-cell stock-cell-col">
                            {isUrgent ? (
                              <span className="stock-urgent">
                                ⚠️ Urgente comprar
                              </span>
                            ) : (
                              <>
                                <div className="stock-bar-wrap">
                                  <div className="stock-bar">
                                    <div
                                      className={`stock-fill ${stockClass}`}
                                      style={{
                                        width: `${Math.min(100, pct ?? 0)}%`,
                                      }}
                                    />
                                  </div>
                                  <div className="stock-labels">
                                    <span
                                      className={`stock-qty ${
                                        isLow ? "stock-qty-low" : ""
                                      }`}
                                    >
                                      {ing.cantidad}
                                      {ing.unidad}
                                    </span>
                                    {cantMin !== undefined && (
                                      <span className="stock-min-label">
                                        mín: {cantMin}
                                        {ing.unidad}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {isLow && (
                                  <span className="stock-alert-badge">
                                    🛒 Stock bajo
                                  </span>
                                )}
                              </>
                            )}
                            <div className="stock-consume">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                placeholder="consumir"
                                placeholderTextColor="#fff"
                                className="consume-input"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    handleConsumir(ing.id, e.target.value);
                                    e.target.value = "";
                                  }
                                }}
                              />
                            </div>
                          </div>
                        ) : null}
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
                          className="btn-compras"
                          title="Enviar a compras"
                          onClick={() => handleEnviarACompras(ing)}
                        >
                          🛒
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
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Modal de edición ── */}
      {editId && (
        <div className="edit-overlay" onClick={handleEditCancel}>
          <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="edit-modal-header">
              <h2>✏️ Editar Ingrediente</h2>
              <button className="edit-modal-close" onClick={handleEditCancel}>
                ✕
              </button>
            </div>

            <form onSubmit={handleEditSave} className="edit-modal-form">
              <div className="form-group">
                <label>Nombre</label>
                <input
                  type="text"
                  value={editNombre}
                  onChange={(e) => setEditNombre(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="form-group">
                <label>Unidad de medida</label>
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
              </div>

              <div className="form-group">
                <label>Cantidad existente ({editUnidad})</label>
                <input
                  type="text"
                  value={cantidadexite}
                  onChange={(e) => setCantidadexite(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>
                    Cantidad comprada ({editUnidad}){" "}
                    <span className="label-opcional">(opcional)</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="dejar vacío para no cambiar"
                    value={editCantidad}
                    onChange={(e) => setEditCantidad(e.target.value)}
                  />
                  {(() => {
                    const ingActual = ingredientes.find((x) => x.id === editId);
                    return ingActual?.cantidadUltimaCompra ? (
                      <p className="ultima-compra-info">
                        Última compra:{" "}
                        <strong>
                          {ingActual.cantidadUltimaCompra} {editUnidad}
                        </strong>{" "}
                        — ${ingActual.costoTotal?.toFixed(2)} ( $
                        {formatCostoPorUnidad(ingActual.costoPorUnidad)}/
                        {editUnidad})
                      </p>
                    ) : null;
                  })()}
                </div>
                <div className="form-group">
                  <label>Costo total del paquete ($)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={editCostoTotal}
                    onChange={(e) => setEditCostoTotal(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Cantidad mínima ({editUnidad})</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="Alerta de stock bajo"
                    value={editCantidadMinima}
                    onChange={(e) => setEditCantidadMinima(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Cantidad máxima ({editUnidad})</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="Stock máximo"
                    value={editCantidadMaxima}
                    onChange={(e) => setEditCantidadMaxima(e.target.value)}
                  />
                </div>
              </div>

              {editCostoPorUnidad > 0 && (
                <div className="cost-preview">
                  Costo calculado:{" "}
                  <strong>${formatCostoPorUnidad(editCostoPorUnidad)}</strong>{" "}
                  por{" "}
                  {editUnidad === "g"
                    ? "gramo"
                    : editUnidad === "ml"
                      ? "mililitro"
                      : "unidad"}
                </div>
              )}

              <div className="edit-modal-actions">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={handleEditCancel}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-modal-save"
                  disabled={editSaving || !editNombre.trim() || !editCostoTotal}
                >
                  {editSaving ? "⏳ Guardando..." : "💾 Guardar cambios"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Bodega;
