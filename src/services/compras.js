import { parseCantidad, claveIngrediente } from "./costos";

// ── Lista de compras derivada de los menús ──
//
// La pregunta que responde este módulo NO es "¿qué se me está acabando?" sino
// "¿qué me falta para darle de comer una semana a todos los usuarios que tienen
// menú?". Por eso el punto de partida son los `menuCreado`, no el stock.
//
// El menú de un usuario son 5 días = UNA SEMANA (ver costos.js), así que la
// suma de sus ingredientes ya es la necesidad semanal de ese usuario.
//
// El stock de bodega es UNO SOLO para todos los usuarios: se suma primero la
// necesidad de todos y recién después se resta el stock una única vez. Restarlo
// usuario por usuario contaría el mismo inventario N veces.

const UNIDAD_POR_DEFECTO = "g";

// Orden en que se muestran los grupos: primero lo que pide la cocina.
const ORDEN_ORIGEN = { menu: 0, stock: 1, manual: 2 };

/**
 * ¿El ingrediente está por debajo de su mínimo de bodega?
 * Misma regla que usa Bodega.jsx para pintar la barra de stock: si no hay
 * mínimo declarado, se asume el 25% del máximo.
 */
export function estaBajoMinimo(ing) {
  const max = ing?.cantidadMaxima;
  if (!max) return false;
  const min = ing.cantidadMinima ?? max * 0.25;
  return (ing.cantidad ?? 0) <= min;
}

/**
 * Suma semanal de cada ingrediente pedido por los menús, con el detalle de qué
 * usuario pide cuánto.
 *
 * No se recorre con listas fijas de días/comidas: el esquema del menú cambió
 * con el tiempo (`lunes..viernes` vs `dia1..dia5`, y comidas distintas en cada
 * generación). Se recorre todo el objeto y se suma cualquier nodo que tenga
 * `ingredientes`, igual que calcularCostoMenu.
 *
 * @returns Map<clave, { nombre, qty, unidad, usuarios: Map<id, {id,nombre,qty}> }>
 */
export function necesidadSemanal(usuarios) {
  const mapa = new Map();

  (usuarios || []).forEach((u) => {
    if (!u?.tieneMenu || !u.menuCreado || typeof u.menuCreado !== "object")
      return;

    Object.values(u.menuCreado).forEach((dia) => {
      if (!dia || typeof dia !== "object") return;

      Object.values(dia).forEach((comida) => {
        const ingredientes = comida?.ingredientes;
        if (!ingredientes || typeof ingredientes !== "object") return;

        Object.entries(ingredientes).forEach(([nombre, cantidad]) => {
          // Las cantidades vienen como número (150) o como string ("150g")
          const { qty, unit } = parseCantidad(cantidad);
          if (!qty) return;

          const clave = claveIngrediente(nombre);
          if (!clave) return;

          const acc = mapa.get(clave) ?? {
            nombre,
            qty: 0,
            unidad: unit || "",
            usuarios: new Map(),
          };
          acc.qty += qty;
          if (!acc.unidad && unit) acc.unidad = unit;

          const previo = acc.usuarios.get(u.id) ?? {
            id: u.id,
            nombre: u.nombre,
            qty: 0,
          };
          previo.qty += qty;
          acc.usuarios.set(u.id, previo);

          mapa.set(clave, acc);
        });
      });
    });
  });

  return mapa;
}

/**
 * Lista de compras completa. Se calcula en vivo, no se guarda: al confirmar una
 * compra sube el stock en bodega y el ítem baja o desaparece solo.
 *
 * Tres fuentes, en este orden de prioridad:
 *   menu   → lo que piden los menús y no alcanza a cubrir el stock
 *   stock  → ingredientes bajo el mínimo que no aparecen en ningún menú
 *   manual → agregados a mano desde el botón 🛒 de Bodega (compras/lista_compras)
 *
 * Cuando un ingrediente cae en varias fuentes se compra el mayor de los tres
 * números: así una sola compra cubre la semana y de paso repone el colchón.
 *
 * @param usuarios usuarios normalizados (services/usuarios.js)
 * @param bodega   ingredientes de bodega/mi_bodega
 * @param extras   items de compras/lista_compras (solo agregados manuales)
 */
export function calcularListaCompras(usuarios, bodega, extras = []) {
  const necesidad = necesidadSemanal(usuarios);

  // Los nombres no siempre coinciden en espacios/mayúsculas entre menú y bodega,
  // por eso todo se cruza por `claveIngrediente`.
  const bodegaPorClave = new Map();
  (bodega || []).forEach((ing) => {
    const clave = claveIngrediente(ing?.nombre);
    if (clave) bodegaPorClave.set(clave, ing);
  });

  const extrasPorClave = new Map();
  (extras || []).forEach((e) => {
    const clave = claveIngrediente(e?.nombre);
    if (clave) extrasPorClave.set(clave, e);
  });

  const claves = new Set([
    ...necesidad.keys(),
    ...bodegaPorClave.keys(),
    ...extrasPorClave.keys(),
  ]);

  const items = [];

  claves.forEach((clave) => {
    const pedido = necesidad.get(clave);
    const ing = bodegaPorClave.get(clave);
    const extra = extrasPorClave.get(clave);

    const necesario = pedido?.qty ?? 0;
    const stock = ing?.cantidad ?? 0;
    const bajoMinimo = estaBajoMinimo(ing);

    const porMenu = Math.max(0, necesario - stock);
    const porStock = bajoMinimo
      ? Math.max(0, (ing.cantidadMaxima ?? 0) - stock)
      : 0;
    const porManual = Math.max(0, extra?.cantidadComprar ?? 0);

    const cantidadComprar = Math.max(porMenu, porStock, porManual);
    // Entra si hay algo que comprar O si algún menú lo pide: los ingredientes
    // que la bodega ya cubre también se muestran, para poder ver de un vistazo
    // TODO lo que se necesita para preparar los menús. Lo único que queda fuera
    // es lo que nadie pide y encima está bien de stock.
    if (cantidadComprar <= 0 && necesario <= 0) return;

    const enBodega = Boolean(ing);
    const costoPorUnidad = ing?.costoPorUnidad ?? extra?.costoPorUnidad ?? 0;

    // El badge responde "¿para qué es esto?": si algún menú lo pide, es de menú
    // aunque la cantidad final la termine mandando el mínimo de bodega.
    let origen = "manual";
    if (necesario > 0) origen = "menu";
    else if (bajoMinimo) origen = "stock";

    // ...y `motivo` responde "¿por qué ESA cantidad?", que no siempre es
    // necesario − stock: cuando además está bajo mínimo se repone al máximo.
    let motivo = "semana";
    if (porStock >= porMenu && porStock >= porManual && porStock > 0)
      motivo = "minimo";
    else if (porManual > porMenu && porManual >= porStock) motivo = "manual";

    items.push({
      id: ing?.id ?? extra?.id ?? `menu:${clave}`,
      clave,
      nombre: ing?.nombre ?? pedido?.nombre ?? extra?.nombre ?? clave,
      origen,
      motivo,
      bajoMinimo,
      manual: Boolean(extra),
      // La bodega alcanza para la semana: se muestra igual, pero sin botón
      cubierto: cantidadComprar <= 0,
      necesario,
      stock,
      cantidadComprar,
      porMenu,
      porStock,
      porManual,
      unidad: ing?.unidad || pedido?.unidad || extra?.unidad || UNIDAD_POR_DEFECTO,
      enBodega,
      costoPorUnidad,
      // Sin precio en bodega no se puede costear: el costo real es mayor
      costoEstimado: costoPorUnidad > 0 ? cantidadComprar * costoPorUnidad : 0,
      // Lo que cuesta lo que se NECESITA, se compre o no: es el número que
      // responde cuánto sale la semana completa de menús.
      costoNecesario: costoPorUnidad > 0 ? necesario * costoPorUnidad : 0,
      usuarios: pedido
        ? [...pedido.usuarios.values()].sort((a, b) => b.qty - a.qty)
        : [],
    });
  });

  items.sort((a, b) => {
    // Primero lo que hay que comprar; lo que la bodega ya cubre, al final
    if (a.cubierto !== b.cubierto) return a.cubierto ? 1 : -1;
    const cmp = ORDEN_ORIGEN[a.origen] - ORDEN_ORIGEN[b.origen];
    if (cmp !== 0) return cmp;
    return a.nombre.localeCompare(b.nombre, undefined, { sensitivity: "base" });
  });

  const usuariosConMenu = (usuarios || []).filter((u) => u?.tieneMenu).length;

  return {
    items,
    resumen: {
      usuariosConMenu,
      ingredientesEnMenus: necesidad.size,
      totalItems: items.length,
      porComprar: items.filter((i) => !i.cubierto).length,
      cubiertos: items.filter((i) => i.cubierto).length,
      // Lo que hay que gastar ahora
      costoEstimado: items.reduce((a, i) => a + i.costoEstimado, 0),
      // Lo que cuesta la semana completa de menús, esté o no en bodega
      costoNecesarioSemana: items.reduce((a, i) => a + i.costoNecesario, 0),
      sinRegistrarEnBodega: items.filter((i) => !i.enBodega).length,
    },
  };
}
