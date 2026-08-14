// ── Entregas ──
// Panel de los pedidos de delivery. Se alimenta EXCLUSIVAMENTE de la colección
// Firestore `entregas`, en vivo: cuando un usuario ordena desde el menú semanal
// su pedido aparece aquí solo, con todos los datos del documento.
//
// El campo `estado` que se mueve desde aquí es el mismo que el cliente ve en su
// app como barra de seguimiento, así que los botones escriben en Firestore y
// nada más — no hay estado en localStorage.

import { Component, useMemo, useState } from "react";
import {
  ESTADOS_ENTREGA,
  SIGUIENTE_ESTADO,
  escalar,
  etiquetaDia,
  fechaHora,
  iconoComida,
  iconoEtiqueta,
  indiceEstado,
  infoEstado,
  listaChips,
  listaIngredientes,
  useCambiarEstado,
  useEntregas,
  useTelefonos,
} from "../services/entregas";
import "./Deliveries.css";

// Pestañas de filtrado. "activas" es lo que el admin mira todo el día: lo que
// todavía tiene que salir de la cocina.
const ACTIVOS = ["pendiente", "preparando", "en_camino"];

const TABS = [
  { key: "activas", label: "🔥 Activas", estados: ACTIVOS },
  { key: "pendiente", label: "⏳ Pendientes", estados: ["pendiente"] },
  { key: "preparando", label: "👩‍🍳 Preparando", estados: ["preparando"] },
  { key: "en_camino", label: "🛵 En camino", estados: ["en_camino"] },
  { key: "entregado", label: "✅ Entregadas", estados: ["entregado"] },
  { key: "cancelado", label: "❌ Canceladas", estados: ["cancelado"] },
];

// Lo que se puede escribir en el buscador y contra qué se compara.
const textoBuscable = (e) =>
  [
    e.nombre,
    e.correo,
    e.diaLabel,
    e.ubicacion.direccion,
    e.ubicacion.ciudad,
    e.ubicacion.etiqueta,
    e.ubicacion.referencia,
    ...e.items.map((it) => `${it.nombre || ""} ${it.label || ""}`),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

function Deliveries() {
  const { entregas, cargando, error } = useEntregas();
  const telefonos = useTelefonos();
  const { mover, guardandoId } = useCambiarEstado();

  const [tab, setTab] = useState("activas");
  const [busqueda, setBusqueda] = useState("");
  const [detalle, setDetalle] = useState(null);

  // Contadores por estado para las tarjetas de arriba y las pestañas.
  const conteo = useMemo(() => {
    const c = { total: entregas.length, activas: 0 };
    ESTADOS_ENTREGA.forEach((e) => (c[e] = 0));
    c.cancelado = 0;
    entregas.forEach((e) => {
      c[e.estado] = (c[e.estado] || 0) + 1;
      if (ACTIVOS.includes(e.estado)) c.activas += 1;
    });
    return c;
  }, [entregas]);

  // Filtro (pestaña + búsqueda) y orden por hora de entrega: lo más próximo
  // primero. Lo que no tiene fecha se va al final, no se puede priorizar.
  const listado = useMemo(() => {
    const estados = TABS.find((t) => t.key === tab)?.estados || ACTIVOS;
    const q = busqueda.trim().toLowerCase();

    return entregas
      .filter((e) => estados.includes(e.estado))
      .filter((e) => !q || textoBuscable(e).includes(q))
      .sort((a, b) => {
        if (a.programadaMs == null) return 1;
        if (b.programadaMs == null) return -1;
        return a.programadaMs - b.programadaMs;
      });
  }, [entregas, tab, busqueda]);

  // Separadores "Hoy" / "Mañana" / "12 ago" dentro de la lista ya ordenada.
  const grupos = useMemo(() => {
    const out = [];
    listado.forEach((e) => {
      const dia = etiquetaDia(e.programadaMs);
      const ultimo = out[out.length - 1];
      if (ultimo?.dia === dia) ultimo.entregas.push(e);
      else out.push({ dia, entregas: [e] });
    });
    return out;
  }, [listado]);

  return (
    <div className="deliveries">
      <header className="deliveries-header">
        <h1>🚚 Entregas</h1>
        <p className="subtitle">
          Pedidos de la colección <code>entregas</code>, en tiempo real. Al
          cambiar el estado, el usuario lo ve al instante en su app.
        </p>
      </header>

      {/* ── RESUMEN ── */}
      <div className="del-cards">
        <ResumenCard icono="📦" label="Total" valor={conteo.total} tono="accent" />
        <ResumenCard icono="⏳" label="Pendientes" valor={conteo.pendiente} tono="warn" />
        <ResumenCard icono="👩‍🍳" label="Preparando" valor={conteo.preparando} tono="premium" />
        <ResumenCard icono="🛵" label="En camino" valor={conteo.en_camino} tono="accent" />
        <ResumenCard icono="✅" label="Entregadas" valor={conteo.entregado} tono="success" />
      </div>

      {/* ── PESTAÑAS ── */}
      <div className="del-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`del-tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} (
            {t.key === "activas"
              ? conteo.activas
              : (conteo[t.estados[0]] ?? 0)}
            )
          </button>
        ))}
      </div>

      {/* ── BÚSQUEDA ── */}
      <div className="del-toolbar">
        <input
          className="del-search"
          type="text"
          placeholder="🔍 Buscar por nombre, correo, dirección, día o plato..."
          value={busqueda}
          onChange={(ev) => setBusqueda(ev.target.value)}
        />
        <span className="del-result-count">
          {listado.length} entrega{listado.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── LISTA ── */}
      {cargando ? (
        <div className="del-empty">
          <div className="del-empty-icon">⏳</div>
          <h2>Cargando entregas…</h2>
        </div>
      ) : error ? (
        <div className="del-empty del-empty-error">
          <div className="del-empty-icon">😕</div>
          <h2>No pudimos leer las entregas</h2>
          <p>Revisa la conexión o los permisos de Firestore.</p>
        </div>
      ) : listado.length === 0 ? (
        <div className="del-empty">
          <div className="del-empty-icon">📭</div>
          <h2>No hay entregas aquí</h2>
          <p>
            {busqueda.trim()
              ? "Ninguna entrega coincide con tu búsqueda."
              : entregas.length === 0
                ? "Todavía no hay pedidos en la colección entregas."
                : "No hay pedidos en este estado."}
          </p>
        </div>
      ) : (
        <div className="del-list">
          {grupos.map((g) => (
            <div key={g.dia}>
              <div className="del-section-title">
                <span className="del-section-icon">📅</span> {g.dia}
                <span className="del-section-count">{g.entregas.length}</span>
              </div>
              {g.entregas.map((e) => (
                <ErrorBoundary
                  key={e.id}
                  mensaje={`No se pudo mostrar el pedido de ${e.nombre}.`}
                >
                  <EntregaCard
                    entrega={e}
                    telefono={telefonos.get(e.uid)}
                    guardando={guardandoId === e.id}
                    onMover={mover}
                    onDetalle={() => setDetalle(e)}
                  />
                </ErrorBoundary>
              ))}
            </div>
          ))}
        </div>
      )}

      {detalle && (
        <ErrorBoundary
          mensaje="No se pudo mostrar el detalle de este pedido."
          onCerrar={() => setDetalle(null)}
        >
          <ModalDetalle entrega={detalle} onCerrar={() => setDetalle(null)} />
        </ErrorBoundary>
      )}
    </div>
  );
}

function ResumenCard({ icono, label, valor, tono }) {
  return (
    <div className="del-card">
      <div className="del-card-icon">{icono}</div>
      <div className="del-card-info">
        <span className="del-card-label">{label}</span>
        <span className={`del-card-value ${tono}`}>{valor ?? 0}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tarjeta de entrega                                                  */
/* ------------------------------------------------------------------ */

function EntregaCard({ entrega: e, telefono, guardando, onMover, onDetalle }) {
  const estado = infoEstado(e.estado);
  const siguiente = SIGUIENTE_ESTADO[e.estado];
  const { lat, lng, direccion } = e.ubicacion;

  const navegar = () => {
    const destino =
      lat && lng ? `${lat},${lng}` : encodeURIComponent(direccion || "");
    if (!destino) return;
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${destino}`,
      "_blank",
    );
  };

  const whatsapp = () => {
    const tel = String(telefono).replace(/\D/g, "");
    const platos = e.items.map((it) => it.nombre || it.label).join(", ");
    const msg = encodeURIComponent(
      `¡Hola ${e.nombre}! 🛵 Tu pedido de Rita (${platos}) va en camino a ${e.ubicacion.etiqueta || "tu dirección"}.`,
    );
    window.open(`https://wa.me/${tel}?text=${msg}`, "_blank");
  };

  return (
    <div className={`del-card-entrega del-estado-${e.estado}`}>
      {/* ── Cuándo ── */}
      <div className="del-card-entrega-left">
        <div className="del-hora-big">{e.entrega.hora}</div>
        <span className="del-fecha-badge">{etiquetaDia(e.programadaMs)}</span>
        <span className={`del-tipo-badge del-tipo-${e.entrega.tipo}`}>
          {e.entrega.tipo === "ahora" ? "⚡ Ahora" : "🕐 Programada"}
        </span>
      </div>

      {/* ── Quién y qué ── */}
      <div className="del-card-entrega-center">
        <div className="del-card-entrega-user">
          <span className="del-user-name-inline">{e.nombre}</span>
          <span className="del-user-email-inline">{e.correo}</span>
          {telefono && (
            <span className="del-user-phone-inline">📞 {telefono}</span>
          )}
          <span className={`del-badge-sm del-badge-${e.plan.color}`}>
            {e.plan.label}
          </span>
        </div>

        <div className="del-chips">
          {e.diaLabel && <span className="del-chip">📆 {e.diaLabel}</span>}
          {e.origen && <span className="del-chip del-chip-origen">{e.origen}</span>}
        </div>

        <div className="del-items">
          {e.items.length === 0 ? (
            <div className="del-item del-item-vacio">Sin platos en el pedido</div>
          ) : (
            e.items.map((it, i) => {
              // Todo lo que viene de la IA pasa por escalar(): un objeto suelto
              // en el JSX tumbaría la lista entera.
              const kcal = escalar(it.calorias);
              return (
                <div className="del-item" key={`${it.comida}-${i}`}>
                  <span className="del-item-icon">{iconoComida(it.comida)}</span>
                  <span className="del-item-label">{it.label || it.comida}</span>
                  <span className="del-item-nombre">{it.nombre || "—"}</span>
                  {kcal != null && (
                    <span className="del-item-cal">{kcal} kcal</span>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="del-ubicacion">
          <span className="del-ubicacion-icon">
            {iconoEtiqueta(e.ubicacion.etiqueta)}
          </span>
          <span>
            {e.ubicacion.etiqueta && (
              <strong>{e.ubicacion.etiqueta} · </strong>
            )}
            {direccion || "Sin dirección"}
            {e.ubicacion.ciudad ? `, ${e.ubicacion.ciudad}` : ""}
          </span>
          {e.ubicacion.referencia && (
            <span className="del-referencia"> — Ref: {e.ubicacion.referencia}</span>
          )}
        </div>
      </div>

      {/* ── Estado y acciones ── */}
      <div className="del-card-entrega-right">
        <div className={`del-status-overall del-status-${e.estado}`}>
          {estado.icono} {estado.label}
        </div>

        {/* El mismo recorrido de 4 pasos que ve el cliente en su app. */}
        {e.estado !== "cancelado" && (
          <div className="del-stepper" title={estado.desc}>
            {ESTADOS_ENTREGA.map((paso, i) => (
              <span
                key={paso}
                className={`del-step ${i <= indiceEstado(e.estado) ? "is-on" : ""}`}
              />
            ))}
          </div>
        )}

        <div className="del-action-buttons">
          {(lat || direccion) && (
            <button className="del-btn-navegar" onClick={navegar} title="Abrir en Google Maps">
              🗺️ Navegar
            </button>
          )}

          {telefono && (
            <button className="del-btn-avisar" onClick={whatsapp} title="Escribir por WhatsApp">
              📲 WhatsApp
            </button>
          )}

          <button className="del-btn-detalle" onClick={onDetalle}>
            👁️ Ver detalle
          </button>

          {siguiente && (
            <button
              className="del-btn-avanzar"
              disabled={guardando}
              onClick={() => onMover(e.id, siguiente)}
            >
              {guardando
                ? "Guardando…"
                : `${infoEstado(siguiente).icono} ${infoEstado(siguiente).label}`}
            </button>
          )}

          {!e.esFinal && (
            <button
              className="del-btn-cancelar"
              disabled={guardando}
              onClick={() => {
                if (confirm(`¿Cancelar el pedido de ${e.nombre}?`)) {
                  onMover(e.id, "cancelado");
                }
              }}
            >
              ❌ Cancelar
            </button>
          )}

          {/* Salida de emergencia para un clic equivocado: devuelve el pedido
              al último paso activo en vez de dejarlo cerrado por error. */}
          {e.esFinal && (
            <button
              className="del-btn-deshacer"
              disabled={guardando}
              onClick={() =>
                onMover(e.id, e.estado === "entregado" ? "en_camino" : "pendiente")
              }
            >
              ↩ Deshacer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal de detalle: TODO lo que trae el documento                     */
/* ------------------------------------------------------------------ */

function Campo({ label, valor }) {
  // Un objeto se aplana antes de pintarlo: ni crashea ni sale "[object Object]".
  const texto = typeof valor === "object" && valor !== null ? escalar(valor) : valor;
  if (texto === undefined || texto === null || texto === "") return null;
  return (
    <div className="del-modal-field">
      <span className="del-modal-field-label">{label}</span>
      <span className="del-modal-field-value">{String(texto)}</span>
    </div>
  );
}

/**
 * Bloque de etiquetas. Recibe el array YA normalizado por listaIngredientes()
 * o listaChips(), porque los campos de la IA son objetos, no arrays.
 */
function Lista({ label, valores }) {
  if (!valores?.length) return null;
  return (
    <div className="del-modal-lista">
      <span className="del-modal-field-label">{label}</span>
      <div className="del-modal-tags">
        {valores.map((v, i) => (
          <span className="del-modal-tag" key={`${v}-${i}`}>
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Un documento con una forma inesperada (los platos los escribe un LLM, no hay
 * esquema que lo garantice) debe romper como mucho su propia tarjeta. Sin esto,
 * un solo campo raro deja el panel entero en negro.
 */
class ErrorBoundary extends Component {
  state = { fallo: false };

  static getDerivedStateFromError() {
    return { fallo: true };
  }

  componentDidCatch(error, info) {
    console.error("[Entregas] no se pudo pintar", error, info);
  }

  render() {
    if (this.state.fallo) {
      return (
        <div className="del-error-box">
          <span>⚠️ {this.props.mensaje || "No se pudo mostrar este contenido."}</span>
          {/* Sin esto el aviso del modal se quedaría fijo: el padre sigue
              creyendo que hay un detalle abierto. */}
          {this.props.onCerrar && (
            <button onClick={this.props.onCerrar}>Cerrar</button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

function ModalDetalle({ entrega: e, onCerrar }) {
  const estado = infoEstado(e.estado);
  const u = e.ubicacion;

  return (
    <div className="del-modal-overlay" onClick={onCerrar}>
      <div className="del-modal" onClick={(ev) => ev.stopPropagation()}>
        <div className="del-modal-header">
          <h2>
            {estado.icono} Pedido de {e.nombre}
          </h2>
          <button className="del-modal-close" onClick={onCerrar}>
            ✕
          </button>
        </div>

        <div className="del-modal-body">
          <section className="del-modal-section">
            <h3>👤 Usuario</h3>
            <Campo label="Nombre" valor={e.nombre} />
            <Campo label="Correo" valor={e.correo} />
            <Campo label="Plan" valor={e.plan.label} />
            <Campo label="UID" valor={e.uid} />
            <Campo label="ID del documento" valor={e.id} />
          </section>

          <section className="del-modal-section">
            <h3>🛵 Entrega</h3>
            <Campo label="Estado" valor={`${estado.label} (${e.estado})`} />
            <Campo label="Hora" valor={e.entrega.hora} />
            <Campo
              label="Tipo"
              valor={e.entrega.tipo === "ahora" ? "Ahora" : "Programada"}
            />
            <Campo label="Para mañana" valor={e.entrega.paraManana ? "Sí" : "No"} />
            <Campo label="Fecha (ISO)" valor={e.entrega.fechaISO} />
            <Campo label="Programada para" valor={fechaHora(e.programadaMs)} />
            <Campo label="Día del menú" valor={`${e.diaLabel} (${e.dia})`} />
            <Campo label="Origen" valor={e.origen} />
            <Campo label="Creada en" valor={fechaHora(e.creadaMs)} />
            {e.canceladaMs && (
              <Campo label="Cancelada en" valor={fechaHora(e.canceladaMs)} />
            )}
          </section>

          <section className="del-modal-section">
            <h3>
              {iconoEtiqueta(u.etiqueta)} Ubicación
            </h3>
            <Campo label="Etiqueta" valor={u.etiqueta} />
            <Campo label="Dirección" valor={u.direccion} />
            <Campo label="Ciudad" valor={u.ciudad} />
            <Campo label="Referencia" valor={u.referencia} />
            <Campo
              label="Coordenadas"
              valor={u.lat != null && u.lng != null ? `${u.lat}, ${u.lng}` : ""}
            />
            <Campo label="Predeterminada" valor={u.predeterminada ? "Sí" : "No"} />
            <Campo label="ID dirección" valor={u.id} />
            <Campo label="Creada en" valor={fechaHora(u.creadaMs)} />
            <Campo label="Actualizada en" valor={fechaHora(u.actualizadaMs)} />
          </section>

          <section className="del-modal-section">
            <h3>🍽️ Platos ({e.items.length})</h3>
            {e.items.map((it, i) => {
              // `calorias` es escalar pero `proteinas` es { total: "30 g" }:
              // pintarlo tal cual era lo que dejaba la pantalla en negro.
              const kcal = escalar(it.calorias);
              const proteina = escalar(it.proteinas);
              return (
                <div className="del-modal-plato" key={`${it.comida}-${i}`}>
                  <div className="del-modal-plato-head">
                    <span className="del-item-icon">{iconoComida(it.comida)}</span>
                    <strong>{it.nombre || "Sin nombre"}</strong>
                    <span className="del-modal-plato-tipo">
                      {it.label || it.comida}
                    </span>
                  </div>
                  {it.descripcion && (
                    <p className="del-modal-plato-desc">{it.descripcion}</p>
                  )}
                  <div className="del-modal-macros">
                    {kcal != null && (
                      <span className="del-modal-macro">🔥 {kcal} kcal</span>
                    )}
                    {proteina != null && (
                      <span className="del-modal-macro">💪 {proteina} proteína</span>
                    )}
                  </div>
                  <Lista
                    label="Ingredientes"
                    valores={listaIngredientes(it.ingredientes)}
                  />
                  <Lista label="Vitaminas" valores={listaChips(it.vitaminas)} />
                  <Lista label="Minerales" valores={listaChips(it.minerales)} />
                </div>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}

export default Deliveries;
