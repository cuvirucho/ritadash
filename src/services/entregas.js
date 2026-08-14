// ── Colección `entregas`: los pedidos de delivery reales ──
//
// Los documentos los crea la web de usuario al ordenar desde el menú semanal
// (webpreventa/rita/src/Rita/ModalOrdenar.jsx). Este panel es el otro extremo:
// lee todo en vivo y es el único que puede mover el campo `estado`.
//
// Forma del documento:
//   uid, correo, nombre, plan, origen, dia, diaLabel,
//   items: [{ comida, label, nombre, descripcion, calorias, proteinas,
//             ingredientes, vitaminas, minerales }],
//   ubicacion: { id, etiqueta, ciudad, direccion, referencia, lat, lng,
//                predeterminada, creadaEn, actualizadaEn },   ← copia congelada
//   entrega:   { tipo, hora, paraManana, fechaISO, programadaPara },
//   estado, creadaEn, canceladaEn

import { useCallback, useEffect, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firbase/Firebase";
import { tsToMs } from "./usuarios";
import { normalizarPlan } from "./planes";

/* ------------------------------------------------------------------ */
/* Estados                                                             */
/* ------------------------------------------------------------------ */

/**
 * ESPEJO de webpreventa/rita/src/UsuarioHome/secciones/deliveryUtils.js.
 * Los dos proyectos no comparten código, así que estas constantes están
 * duplicadas a propósito: si allí cambia el recorrido, hay que cambiarlo aquí
 * también o el seguimiento que ve el cliente dejará de cuadrar con el panel.
 *
 * El ORDEN DEL ARRAY es el orden del seguimiento. `cancelado` queda fuera
 * porque no es un paso del camino, es una salida.
 */
export const ESTADOS_ENTREGA = [
  "pendiente",
  "preparando",
  "en_camino",
  "entregado",
];

export const INFO_ESTADO = {
  pendiente: { icono: "⏳", label: "Pendiente", desc: "Pedido recibido" },
  preparando: { icono: "👩‍🍳", label: "Preparando", desc: "En cocina" },
  en_camino: { icono: "🛵", label: "En camino", desc: "Salió a reparto" },
  entregado: { icono: "✅", label: "Entregado", desc: "Pedido entregado" },
  cancelado: { icono: "❌", label: "Cancelado", desc: "Pedido cancelado" },
};

// A dónde lleva el botón de avance desde cada estado. Los finales no están:
// de ahí ya no se avanza.
export const SIGUIENTE_ESTADO = {
  pendiente: "preparando",
  preparando: "en_camino",
  en_camino: "entregado",
};

// Un estado desconocido cuenta como "pendiente" (0) en vez de -1: si alguien
// escribe otra cosa en el campo, el seguimiento degrada en lugar de romperse.
export const indiceEstado = (estado) => {
  const i = ESTADOS_ENTREGA.indexOf(estado);
  return i === -1 ? 0 : i;
};

export const infoEstado = (estado) =>
  INFO_ESTADO[estado] || INFO_ESTADO.pendiente;

// Un pedido "cerrado": ya no se mueve.
export const esEstadoFinal = (estado) =>
  estado === "entregado" || estado === "cancelado";

/* ------------------------------------------------------------------ */
/* Presentación                                                        */
/* ------------------------------------------------------------------ */

// Iconos por tipo de comida. `items[].comida` trae la clave del menú semanal.
export const ICONO_COMIDA = {
  desayuno: "☀️",
  snack1: "🍎",
  snack_manana: "🍎",
  almuerzo: "🍲",
  snack2: "🥜",
  snack_tarde: "🥜",
  cena: "🌙",
};

export const iconoComida = (comida) => ICONO_COMIDA[comida] || "🍽️";

// Mismo criterio que iconoEtiqueta() de deliveryUtils.js.
export const iconoEtiqueta = (etiqueta = "") => {
  const e = String(etiqueta).toLowerCase();
  if (e.includes("casa") || e.includes("hogar")) return "🏠";
  if (e.includes("trabajo") || e.includes("oficina")) return "💼";
  return "📍";
};

/* ------------------------------------------------------------------ */
/* Campos nutricionales de un plato                                    */
/* ------------------------------------------------------------------ */

/**
 * ESPEJO de webpreventa/rita/src/Rita/ModalPlato.jsx (líneas 6-23 y 61-64).
 *
 * Los platos los escribe la IA con la forma que le exige el prompt del backend
 * (appmovil/bakenfuntions/functions/index.js:310-345), y NINGUNO de estos
 * campos es un array:
 *
 *   ingredientes: { "tomate": "200 g" }        ← objeto
 *   vitaminas:    { "Vitamina C": "45%" }      ← objeto
 *   minerales:    { "hierro": "3 mg" }         ← objeto
 *   proteinas:    { total: "30 g" }            ← objeto, ojo
 *   calorias:     520                          ← escalar
 *
 * Pintar `proteinas` directamente en JSX revienta React ("Objects are not
 * valid as a React child"), así que todo lo que salga a pantalla pasa por
 * aquí. Se tolera además array y string porque hay documentos antiguos.
 */

// { nombre: cantidad } → ["tomate — 200 g", …]
export const listaIngredientes = (ingredientes) => {
  if (!ingredientes) return [];
  if (Array.isArray(ingredientes)) return ingredientes.map(String);
  if (typeof ingredientes === "string") return [ingredientes];
  return Object.entries(ingredientes).map(([nombre, cantidad]) =>
    cantidad ? `${nombre} — ${cantidad}` : nombre,
  );
};

// { tipo: valor } → ["Vitamina C: 45%", …]
export const listaChips = (obj) => {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.map(String);
  if (typeof obj === "string") return [obj];
  return Object.entries(obj).map(([clave, valor]) =>
    valor ? `${clave}: ${valor}` : clave,
  );
};

/**
 * Cualquier valor que vaya a pintarse suelto en el JSX. Si llega un objeto se
 * saca `total` (la forma de `proteinas`) y si no hay nada usable se devuelve
 * null: mejor un "—" que tumbar la pantalla entera.
 */
export const escalar = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    const total = Array.isArray(v) ? null : v.total;
    return total === null || total === undefined || typeof total === "object"
      ? null
      : total;
  }
  return v;
};

const dosDigitos = (n) => String(n).padStart(2, "0");

const mismoDia = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// "Hoy" · "Mañana" · "02 ago". Se usa para agrupar la lista por fecha.
export const etiquetaDia = (ms) => {
  if (!ms) return "Sin fecha";
  const fecha = new Date(ms);
  const hoy = new Date();
  const manana = new Date(hoy);
  manana.setDate(manana.getDate() + 1);

  if (mismoDia(fecha, hoy)) return "Hoy";
  if (mismoDia(fecha, manana)) return "Mañana";
  return fecha.toLocaleDateString("es-EC", { day: "2-digit", month: "short" });
};

// "14/08/2026 08:49" — para las fechas del modal de detalle.
export const fechaHora = (ms) => {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${dosDigitos(d.getDate())}/${dosDigitos(d.getMonth() + 1)}/${d.getFullYear()} ${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;
};

/* ------------------------------------------------------------------ */
/* Normalización                                                       */
/* ------------------------------------------------------------------ */

/**
 * Aplana un documento de `entregas` a la forma que consume la UI.
 *
 * Todas las fechas pasan por tsToMs() porque en el mismo documento conviven
 * dos formatos: `creadaEn` es un Timestamp de servidor y `ubicacion.creadaEn`
 * es un número de milisegundos que escribió el cliente.
 */
export function normalizarEntrega(raw) {
  const entrega = raw.entrega || {};
  const ubicacion = raw.ubicacion || {};
  const estado = raw.estado || "pendiente";

  return {
    id: raw.id,
    uid: raw.uid || "",
    nombre: raw.nombre || "Sin nombre",
    correo: raw.correo || "—",
    plan: normalizarPlan(raw.plan),
    origen: raw.origen || "",
    dia: raw.dia || "",
    diaLabel: raw.diaLabel || raw.dia || "",

    items: Array.isArray(raw.items) ? raw.items : [],

    ubicacion: {
      ...ubicacion,
      creadaMs: tsToMs(ubicacion.creadaEn),
      actualizadaMs: tsToMs(ubicacion.actualizadaEn),
    },

    entrega: {
      tipo: entrega.tipo || "programada",
      hora: entrega.hora || "--:--",
      paraManana: Boolean(entrega.paraManana),
      fechaISO: entrega.fechaISO || "",
    },

    estado,
    esFinal: esEstadoFinal(estado),

    // Cuándo tiene que llegar (lo que ordena la lista) y cuándo se pidió.
    programadaMs: tsToMs(entrega.programadaPara),
    creadaMs: tsToMs(raw.creadaEn),
    canceladaMs: tsToMs(raw.canceladaEn),

    raw,
  };
}

/* ------------------------------------------------------------------ */
/* Lectura                                                             */
/* ------------------------------------------------------------------ */

const entregasRef = collection(db, "entregas");
const usuariosRef = collection(db, "UsuariosActivos");

/**
 * Suscripción en vivo a toda la colección.
 *
 * Sin orderBy a propósito (mismo criterio que MisEntregas.jsx en webpreventa):
 * un `orderBy` deja fuera los documentos a los que les falte el campo, y aquí
 * ordenamos por `entrega.programadaPara`, que es anidado. Se ordena en JS.
 */
export function useEntregas() {
  const [entregas, setEntregas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const cancelar = onSnapshot(
      entregasRef,
      (snap) => {
        setEntregas(
          snap.docs.map((d) => normalizarEntrega({ id: d.id, ...d.data() })),
        );
        setError(null);
        setCargando(false);
      },
      (err) => {
        console.error("[entregas] onSnapshot falló", err);
        setError(err);
        setCargando(false);
      },
    );
    return cancelar;
  }, []);

  return { entregas, cargando, error };
}

/**
 * Mapa uid → teléfono, solo para el botón de WhatsApp: el documento de
 * `entregas` guarda correo y nombre, pero no el teléfono.
 *
 * Se indexa por el id del documento Y por el campo `uid` porque los dos se
 * usan indistintamente como identificador del usuario (ver normalizarUsuario
 * en services/usuarios.js).
 *
 * Un fallo aquí no puede tumbar la pantalla: se queda con el mapa vacío y lo
 * único que pasa es que no sale el botón de WhatsApp.
 */
export function useTelefonos() {
  const [telefonos, setTelefonos] = useState(() => new Map());

  useEffect(() => {
    let vivo = true;
    getDocs(usuariosRef)
      .then((snap) => {
        if (!vivo) return;
        const mapa = new Map();
        snap.docs.forEach((d) => {
          const data = d.data();
          // Misma cadena de fallbacks que normalizarUsuario() en usuarios.js:
          // el teléfono de los usuarios antiguos solo está en datapayphone.
          const tel =
            data.telefono ||
            data.datapayphone?.optionalParameter1 ||
            data.datapayphone?.phoneNumber;
          if (!tel || tel === "—") return;
          mapa.set(d.id, tel);
          if (data.uid) mapa.set(data.uid, tel);
        });
        setTelefonos(mapa);
      })
      .catch((err) => console.error("[entregas] no se pudo leer teléfonos", err));
    return () => {
      vivo = false;
    };
  }, []);

  return telefonos;
}

/* ------------------------------------------------------------------ */
/* Escritura                                                           */
/* ------------------------------------------------------------------ */

/**
 * Mueve el estado de un pedido. Es la única escritura del módulo.
 *
 * El cliente ve este cambio en vivo en su sección "Mis entregas", así que
 * `estado` tiene que ser uno de los valores de INFO_ESTADO y nada más.
 * Solo el admin puede hacerlo (ver la regla de `entregas` en firestore.rules).
 */
export async function cambiarEstado(id, estado) {
  const cambios = { estado, actualizadaEn: serverTimestamp() };
  // La app del usuario y las reglas ya usan `canceladaEn` para la cancelación
  // del propio dueño; se mantiene el mismo campo cuando cancela el admin.
  if (estado === "cancelado") cambios.canceladaEn = serverTimestamp();
  await updateDoc(doc(db, "entregas", id), cambios);
}

/** Hook con el estado de "guardando" para deshabilitar los botones. */
export function useCambiarEstado() {
  const [guardandoId, setGuardandoId] = useState(null);

  const mover = useCallback(async (id, estado) => {
    setGuardandoId(id);
    try {
      await cambiarEstado(id, estado);
    } catch (err) {
      console.error("[entregas] no se pudo cambiar el estado", err);
      alert("❌ No se pudo actualizar el estado. Revisa tu conexión.");
    } finally {
      setGuardandoId(null);
    }
  }, []);

  return { mover, guardandoId };
}
