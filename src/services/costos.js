import { SEMANAS_POR_MES } from "./planes";

// ── Costeo de menús contra los precios de bodega ──
//
// La estructura del menú cambió con el tiempo:
//   legado : menu.menucreado.{dia1..dia5}.{desayuno,snack1,almuerzo,snack2,cena}
//   actual : menuCreado.{lunes..viernes}.{desayuno,almuerzo,cena,bebida,snack}
// Por eso NO se recorre con listas fijas de días/comidas: se recorre todo el
// objeto y se costea cualquier nodo que tenga `ingredientes`. Así funciona con
// las dos formas y con cualquier día o comida que se agregue después.

/** "250g" → { qty: 250, unit: "g" } */
export function parseCantidad(str) {
  if (!str) return { qty: 0, unit: "" };
  const match = String(str).match(/^([\d.]+)\s*([a-zA-Z]*)/);
  return match
    ? { qty: parseFloat(match[1]) || 0, unit: (match[2] || "").toLowerCase() }
    : { qty: 0, unit: "" };
}

// Los nombres en bodega y en el menú no siempre coinciden en espacios/mayúsculas
// (p. ej. "Carne  (res)" vs "Carne (res)").
export const claveIngrediente = (n) =>
  String(n || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Suma cantidad × costoPorUnidad de cada ingrediente del menú que exista en
 * bodega. Devuelve el desglose por ingrediente y los que no se pudieron costear
 * porque no están en bodega (el costo real es mayor).
 *
 * El menú cubre 5 días = UNA SEMANA. Por eso el total se llama `costoSemanal`
 * y se expone también `costoMensual`: comparar el costo de una semana contra un
 * precio mensual era exactamente el error que inflaba la ganancia.
 */
export function calcularCostoMenu(menuCreado, bodega) {
  const detalle = {};
  const faltantes = new Set();
  let costoSemanal = 0;

  if (!menuCreado || typeof menuCreado !== "object")
    return { costoSemanal: 0, costoMensual: 0, detalle, faltantes: [] };

  const precios = new Map(
    (bodega || []).map((b) => [claveIngrediente(b.nombre), b]),
  );

  Object.values(menuCreado).forEach((dia) => {
    if (!dia || typeof dia !== "object") return;

    Object.values(dia).forEach((comida) => {
      const ingredientes = comida?.ingredientes;
      if (!ingredientes || typeof ingredientes !== "object") return;

      Object.entries(ingredientes).forEach(([nombre, cantStr]) => {
        const { qty, unit } = parseCantidad(cantStr);
        if (!qty) return;

        const enBodega = precios.get(claveIngrediente(nombre));
        if (!enBodega) {
          faltantes.add(nombre);
          return;
        }

        const costo = qty * (enBodega.costoPorUnidad || 0);
        costoSemanal += costo;
        detalle[nombre] = {
          qty: (detalle[nombre]?.qty || 0) + qty,
          unit: unit || enBodega.unidad || "",
          costoPorUnidad: enBodega.costoPorUnidad || 0,
          costoTotal: (detalle[nombre]?.costoTotal || 0) + costo,
        };
      });
    });
  });

  return {
    costoSemanal,
    costoMensual: costoSemanal * SEMANAS_POR_MES,
    detalle,
    faltantes: [...faltantes],
  };
}
