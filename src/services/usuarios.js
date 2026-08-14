import { useCallback, useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firbase/Firebase";
import {
  normalizarPlan,
  normalizarModalidad,
  esPagado,
  precioDe,
  ingresoMensualDe,
  siguienteCiclo,
  SEMANAS_POR_MES,
} from "./planes";

const CACHE_KEY = "rita_usuarios_cache";
const CACHE_TS_KEY = "rita_usuarios_ts";
const CACHE_TTL = 1000 * 60 * 60; // 1 hora

const MS_DIA = 1000 * 60 * 60 * 24;

/**
 * Convierte a milisegundos cualquier forma de fecha que exista en Firestore
 * o en el caché de localStorage:
 *  - Timestamp real (tiene .toDate())
 *  - { seconds, nanoseconds } plano (así queda tras JSON.stringify del caché)
 *  - string ISO, Date, number
 */
export function tsToMs(v) {
  if (!v) return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  const parsed = new Date(v).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export const formatearFecha = (ms) =>
  ms
    ? new Date(ms).toLocaleDateString("es-EC", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

/**
 * Aplana un documento de UsuariosActivos a una forma canónica, aceptando
 * el esquema nuevo (nombre, correo, telefono, plan, fechaRegistro, menuCreado)
 * y el legado (datapayphone.*, cart.nombre, createdAt, menu.menucreado).
 */
export function normalizarUsuario(raw) {
  const dp = raw.datapayphone || {};

  const plan = normalizarPlan(raw.plan ?? raw.cart?.nombre);
  const modalidad = normalizarModalidad(raw.modalidad);
  const pagado = esPagado(plan);

  const fechaRegistro = tsToMs(raw.fechaRegistro ?? raw.createdAt);
  const fechaActivacion = tsToMs(raw.activatedAt);
  const fechaMenuCreado = tsToMs(raw.menuCreadoFecha);
  const menuCreado = raw.menuCreado ?? raw.menu?.menucreado ?? null;

  const ahora = Date.now();

  // Próximo cobro: se avanza ciclo a ciclo desde la activación hasta pasar de hoy.
  let proximoCobro = null;
  let cobrosAcumulados = 0;
  if (pagado && fechaActivacion) {
    proximoCobro = fechaActivacion;
    // Tope de seguridad por si una fecha viniera corrupta
    let guarda = 0;
    while (proximoCobro <= ahora && guarda++ < 1000) {
      cobrosAcumulados += 1;
      proximoCobro = siguienteCiclo(proximoCobro, modalidad);
    }
  }

  return {
    id: raw.id,
    uid: raw.uid || raw.id,
    nombre: raw.nombre || dp.optionalParameter4 || "Sin nombre",
    correo: raw.correo || dp.email || dp.optionalParameter2 || "—",
    telefono: raw.telefono || dp.optionalParameter1 || dp.phoneNumber || "—",

    plan,
    modalidad,
    esPagado: pagado,
    precioCiclo: precioDe(plan, modalidad), // lo que paga en cada cobro
    ingresoMensual: ingresoMensualDe(plan, modalidad), // base común de comparación

    fechaRegistro,
    fechaActivacion,
    fechaMenuCreado,
    // Días que tardó en pasar de free a un plan de pago
    diasParaConvertir:
      fechaRegistro && fechaActivacion && fechaActivacion >= fechaRegistro
        ? Math.round((fechaActivacion - fechaRegistro) / MS_DIA)
        : null,

    proximoCobro,
    cobrosAcumulados,
    diasParaCobro: proximoCobro
      ? Math.ceil((proximoCobro - ahora) / MS_DIA)
      : null,
    // Paga pero falta el dato en Firestore: sin activación no hay fecha de cobro,
    // sin modalidad no sabemos cada cuánto cobra.
    cobroSinRegistrar: pagado && (!fechaActivacion || modalidad.asumida),
    faltaActivacion: pagado && !fechaActivacion,
    faltaModalidad: pagado && modalidad.asumida,

    menuCreado,
    tieneMenu: Boolean(menuCreado),
    entregas: raw.ubicaciones?.entregas ?? raw.ubicacines?.entregas ?? [],
    estadoPago: raw.transactionStatus || null,
    raw,
  };
}

/**
 * Fechas de cobro de un usuario dentro de [desdeMs, hastaMs].
 * Solo el primero está confirmado (`activatedAt`); los siguientes son
 * renovaciones estimadas cada ciclo. Nunca se proyecta más allá de hoy.
 */
export function cobrosEnPeriodo(u, desdeMs, hastaMs) {
  if (!u.esPagado || !u.fechaActivacion) return [];

  const limite = Math.min(hastaMs, Date.now());
  const fechas = [];
  let f = u.fechaActivacion;
  let guarda = 0;

  while (f <= limite && guarda++ < 1000) {
    // Solo el cobro que coincide con la activación está confirmado
    if (f >= desdeMs)
      fechas.push({ fecha: f, estimado: f !== u.fechaActivacion });
    f = siguienteCiclo(f, u.modalidad);
  }
  return fechas;
}

/**
 * Semanas de menú servidas dentro del período, contadas desde `menuCreadoFecha`
 * (o desde la activación / registro si ese campo no existe).
 * Va aparte del cobro a propósito: un usuario con menú cuesta dinero aunque su
 * pago no esté registrado en la base.
 */
export function semanasMenuEnPeriodo(u, desdeMs, hastaMs) {
  if (!u.tieneMenu) return 0;

  const inicio = u.fechaMenuCreado ?? u.fechaActivacion ?? u.fechaRegistro;
  if (!inicio) return 0;

  const limite = Math.min(hastaMs, Date.now());
  const MS_SEMANA = MS_DIA * 7;
  let semanas = 0;
  let f = inicio;
  let guarda = 0;

  while (f <= limite && guarda++ < 1000) {
    if (f >= desdeMs) semanas += 1;
    f += MS_SEMANA;
  }
  return semanas;
}

/** Costo del menú imputable al período, a partir del costo de una semana. */
export const costoMenuEnPeriodo = (u, costoSemanal, desdeMs, hastaMs) =>
  costoSemanal * semanasMenuEnPeriodo(u, desdeMs, hastaMs);

/** Costo mensual estimado de un menú semanal. */
export const costoMenuMensual = (costoSemanal) =>
  costoSemanal * SEMANAS_POR_MES;

// ── Caché en localStorage (solo las claves de usuarios) ──
const guardarCache = (data) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(CACHE_TS_KEY, Date.now().toString());
  } catch {
    /* cuota llena: seguimos sin caché */
  }
};

const leerCache = () => {
  const raw = localStorage.getItem(CACHE_KEY);
  const ts = localStorage.getItem(CACHE_TS_KEY);
  if (!raw || !ts) return null;
  if (Date.now() - Number(ts) > CACHE_TTL) return null;
  try {
    return { data: JSON.parse(raw), ts: Number(ts) };
  } catch {
    return null;
  }
};

export const limpiarCacheUsuarios = () => {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(CACHE_TS_KEY);
};

// Más recientes primero; los que no tienen fecha, al final
const ordenar = (lista) =>
  [...lista].sort((a, b) => (b.fechaRegistro || 0) - (a.fechaRegistro || 0));

/**
 * Carga UsuariosActivos una sola vez y los deja normalizados.
 * Sin orderBy: Firestore excluye los documentos que no tienen el campo, y los
 * usuarios nuevos no traen createdAt. El orden se hace en cliente.
 */
export function useUsuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [ultimaActualizacion, setUltimaActualizacion] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(collection(db, "UsuariosActivos"));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      guardarCache(data);
      setUsuarios(ordenar(data.map(normalizarUsuario)));
      setUltimaActualizacion(Date.now());
    } catch (err) {
      console.error("Error cargando usuarios:", err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cache = leerCache();
    if (cache) {
      setUsuarios(ordenar(cache.data.map(normalizarUsuario)));
      setUltimaActualizacion(cache.ts);
    } else {
      cargar();
    }
  }, [cargar]);

  const refrescar = useCallback(() => {
    limpiarCacheUsuarios();
    return cargar();
  }, [cargar]);

  return { usuarios, loading, error, ultimaActualizacion, refrescar };
}

/** Gastos reales (compras de bodega confirmadas desde Compras.jsx) */
export function useGastos() {
  const [gastos, setGastos] = useState([]);

  useEffect(() => {
    getDocs(collection(db, "gastos"))
      .then((snap) =>
        setGastos(
          snap.docs.map((d) => {
            const data = d.data();
            return { id: d.id, ...data, fecha: tsToMs(data.fecha) };
          }),
        ),
      )
      .catch((err) => console.error("Error cargando gastos:", err));
  }, []);

  return gastos;
}

/** Ingredientes de bodega, para costear los menús */
export function useBodega() {
  const [bodega, setBodega] = useState([]);

  useEffect(() => {
    getDoc(doc(db, "bodega", "mi_bodega"))
      .then((snap) => {
        if (snap.exists()) setBodega(snap.data().ingredientes || []);
      })
      .catch((err) => console.error("Error cargando bodega:", err));
  }, []);

  return bodega;
}
