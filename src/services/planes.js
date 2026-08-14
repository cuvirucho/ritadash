// ── Catálogo único de planes y modalidades de cobro ──
// Los precios dependen del plan Y de la modalidad: un Starter semanal paga $55
// cada 7 días, un Starter mensual paga $185 una vez al mes.

// 4 semanas × 5 días = 20 días de entrega = las "60 comidas al mes" del Starter.
// Es el factor con el que se normaliza todo (ingresos y costo de menú) a base mensual.
export const SEMANAS_POR_MES = 4;

export const PLANES = {
  free: {
    key: "free",
    label: "Free",
    color: "free",
    icono: "🆓",
    precios: { semanal: 0, mensual: 0 },
  },
  starter: {
    key: "starter",
    label: "Starter",
    color: "starter",
    icono: "🚀",
    precios: { semanal: 55, mensual: 185 },
  },
  premium: {
    key: "premium",
    label: "Premium",
    color: "premium",
    icono: "⭐",
    precios: { semanal: 59, mensual: 206 },
  },
};

// Orden estable para tablas y barras (de mayor a menor valor)
export const PLANES_ORDEN = [PLANES.premium, PLANES.starter, PLANES.free];

// ── Modalidades ──
// ciclosPorMes:    cuántos cobros entran en un mes
// semanasPorCiclo: cuántas semanas de menú cubre cada cobro
export const MODALIDADES = {
  semanal: {
    key: "semanal",
    label: "Semanal",
    icono: "📅",
    ciclosPorMes: SEMANAS_POR_MES,
    semanasPorCiclo: 1,
    dias: 7,
  },
  mensual: {
    key: "mensual",
    label: "Mensual",
    icono: "🗓️",
    ciclosPorMes: 1,
    semanasPorCiclo: SEMANAS_POR_MES,
    dias: null, // mes de calendario, no días fijos
  },
};

export const MODALIDADES_ORDEN = [MODALIDADES.semanal, MODALIDADES.mensual];

// El documento no trae plan en absoluto. Se muestra, pero no dispara el aviso
// de "plan sin configurar": no hay ningún valor que agregar al catálogo.
const PLAN_SIN_DEFINIR = {
  key: "sin-plan",
  label: "Sin plan",
  color: "desconocido",
  icono: "❓",
  precios: { semanal: 0, mensual: 0 },
  conocido: false,
  vacio: true,
};

/**
 * Acepta cualquier forma en la que haya llegado el plan a lo largo del tiempo:
 * "free", "Starter", "Plan Premium", "  PREMIUM ", undefined.
 * Nunca devuelve null: un plan que no reconocemos se muestra igual, con
 * precio 0 y marcado como desconocido para que salte el aviso en la UI.
 */
export function normalizarPlan(raw) {
  const limpio = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^plan\s+/, "");

  if (!limpio) return PLAN_SIN_DEFINIR;
  if (PLANES[limpio]) return { ...PLANES[limpio], conocido: true };

  return {
    key: limpio,
    label: String(raw).trim(),
    color: "desconocido",
    icono: "❓",
    precios: { semanal: 0, mensual: 0 },
    conocido: false,
    vacio: false,
  };
}

/**
 * `modalidad` es un campo reciente: la mayoría de documentos todavía no lo trae.
 * Cuando falta se asume mensual y se marca `asumida`, que es lo que dispara el
 * panel de "cobros sin registrar" en la UI.
 */
export function normalizarModalidad(raw) {
  const limpio = String(raw ?? "")
    .trim()
    .toLowerCase();

  if (MODALIDADES[limpio]) return { ...MODALIDADES[limpio], asumida: false };
  return { ...MODALIDADES.mensual, asumida: true };
}

export const precioDe = (plan, modalidad) =>
  plan?.precios?.[modalidad?.key] ?? 0;

/** Todo se compara en base mensual: $55/semana equivale a $220/mes. */
export const ingresoMensualDe = (plan, modalidad) =>
  precioDe(plan, modalidad) * (modalidad?.ciclosPorMes ?? 1);

export const esPagado = (plan) =>
  (plan?.precios?.semanal || 0) > 0 || (plan?.precios?.mensual || 0) > 0;

/** Avanza una fecha (ms) un ciclo de cobro. */
export function siguienteCiclo(ms, modalidad) {
  const d = new Date(ms);
  if (modalidad?.key === "semanal") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}
