import { detectOrder, detectStandaloneCustomer } from "../bot/order-heuristics.mjs";

const fixtures = [
  {
    name: "lista con cliente",
    text: "5 calcio holandes\n1 bidon acido\n48 bolsas sal entre fina lavada x 25kg\nBurnhauser",
    customer: "Burnhauser",
    items: 3
  },
  {
    name: "cantidad despues del producto",
    text: "1Ph4\n1 Ph7\nCloro 700 litros\n2 colorante\nDon Emilio",
    customer: "Don Emilio",
    items: 4,
    expected: { product: "Cloro", quantity: 700, unit: "litro" }
  },
  {
    name: "pedido en frase",
    text: "Sumame 4 bolsas de calcio chino al pedido\nLos quebrachitos",
    customer: "Los quebrachitos",
    items: 1
  },
  {
    name: "productos frecuentes adicionales",
    text: "3 anti espumante\n1 quimosina\n1 caja de fermentos\n6 cajas de barras\nMegafee",
    customer: "Megafe",
    items: 4
  },
  {
    name: "cliente numerado",
    text: "1 cloro\nCliente 2",
    customer: "Cliente 2",
    items: 1
  },
  {
    name: "normaliza plurales frecuentes",
    text: "4 cloros\n3 sodas\n2 feculas\nSanta Clara",
    customer: "Santa Clara",
    items: 3,
    normalized: ["hipoclorito de sodio", "soda", "fecula"]
  },
  {
    name: "normaliza equivalencias confirmadas",
    text: "2 cloro\n1 nitrico\n1 lejia\nLa nueva",
    customer: "La Nueva S.A.",
    items: 3,
    normalized: ["hipoclorito de sodio", "acido nitrico", "lejia dornic"]
  },
  {
    name: "unifica megafe y megafee",
    text: "1 cloro\nMegafee",
    customer: "Megafe",
    items: 1
  },
  {
    name: "cliente antes del pedido",
    text: "Molino\nPara mañana necesito 500 litros de Cloro",
    customer: "El Molino S.R.L.",
    items: 1,
    normalized: ["hipoclorito de sodio"]
  },
  {
    name: "variantes de molino fenix",
    text: "400 litros de Cloro\nMolinos Fenix",
    customer: "El Molino S.R.L.",
    items: 1,
    normalized: ["hipoclorito de sodio"]
  },
  {
    name: "nuestros pagos mal escrito",
    text: "2 calcio chino\nNuestro pagos",
    customer: "Nuestros Pagos",
    items: 1
  },
  {
    name: "raggio escrito parecido",
    text: "Sardo raggio de some",
    customer: "Raggio Di Sole",
    items: 1,
    normalized: ["sardo"]
  },
  {
    name: "cantidad al final del producto",
    text: "Dai 3\nlac 2\nLacteos Premium",
    customer: "Lacteos Premium",
    items: 2,
    lineExpectations: [
      { product: "Dai", quantity: 3 },
      { product: "lac", quantity: 2 }
    ]
  },
  {
    name: "ibc como presentacion",
    text: "un IBC de cloro\nEl Molino",
    customer: "El Molino S.R.L.",
    items: 1,
    expected: { product: "cloro", quantity: 1, unit: "ibc" },
    normalized: ["hipoclorito de sodio"]
  },
  {
    name: "calcio generico entra sin frenar el pedido",
    text: "2 calcio\nDon Emilio",
    customer: "Don Emilio",
    items: 1,
    needsReview: false
  },
  {
    name: "bolsas genericas quedan pendientes",
    text: "2 cajas bolsas\nDon Emilio",
    customer: "Don Emilio",
    items: 1,
    needsReview: true
  },
  {
    name: "pago no es pedido",
    text: "Ticket.pdf <adjunto: 00004177-Ticket.pdf>\nEl tupa\nOtro pago mas",
    shouldDetect: false
  },
  {
    name: "horario no es pedido",
    text: "Cambio de horario de administracion Cayelac. Ahora trabajan de corrido hasta las 17.00 h\nPara tenerlo en cuenta por los pagos.",
    shouldDetect: false
  },
  {
    name: "imagen sola no es pedido",
    text: "<adjunto: 00000022-PHOTO-2025-07-07-12-23-56.jpg>",
    shouldDetect: false,
    attachments: [{ kind: "image" }]
  }
];

let failures = 0;

for (const fixture of fixtures) {
  const result = detectOrder({
    text: fixture.text,
    messages: [{ attachments: fixture.attachments ?? [] }]
  });

  if (fixture.shouldDetect === false) {
    if (result) fail(fixture.name, "se detecto un pedido cuando debia ignorarse");
    continue;
  }

  if (!result) {
    fail(fixture.name, "no se detecto el pedido");
    continue;
  }

  if (result.customerGuess !== fixture.customer) {
    fail(fixture.name, `cliente esperado "${fixture.customer}", obtenido "${result.customerGuess}"`);
  }

  if (result.items.length !== fixture.items) {
    fail(fixture.name, `items esperados ${fixture.items}, obtenidos ${result.items.length}`);
  }

  if (fixture.expected) {
    const item = result.items.find((candidate) => candidate.productText === fixture.expected.product);
    if (!item || item.quantity !== fixture.expected.quantity || item.unit !== fixture.expected.unit) {
      fail(fixture.name, "cantidad o unidad del producto no coincide");
    }
  }

  if (fixture.lineExpectations) {
    for (const expected of fixture.lineExpectations) {
      const item = result.items.find((candidate) => candidate.productText.toLowerCase() === expected.product.toLowerCase());
      if (!item || item.quantity !== expected.quantity) {
        fail(fixture.name, `cantidad esperada para ${expected.product}: ${expected.quantity}`);
      }
    }
  }

  if (fixture.normalized) {
    const normalizedItems = result.items.map((item) => item.productNormalized);
    if (fixture.normalized.some((item) => !normalizedItems.includes(item))) {
      fail(fixture.name, "no se unificaron variantes plurales");
    }
  }
  if (fixture.needsReview !== undefined && result.needsReview !== fixture.needsReview) {
    fail(fixture.name, "no marco revision segun el dato incompleto del articulo");
  }
}

if (detectStandaloneCustomer("Don Emilio") !== "Don Emilio") {
  fail("cliente separado", "no reconoce un nombre enviado solo");
}
if (detectStandaloneCustomer("Cliente: Santa Clara") !== "Santa Clara") {
  fail("cliente etiquetado separado", "no limpia la etiqueta cliente");
}
if (detectStandaloneCustomer("Nuestro pagos") !== "Nuestros Pagos") {
  fail("cliente conocido con pagos", "descarto un cliente conocido por palabra administrativa");
}
if (detectStandaloneCustomer("listo") !== null) {
  fail("respuesta comun", "trato una respuesta comun como cliente");
}

if (failures) {
  console.error(`Validacion fallida: ${failures} casos con error.`);
  process.exit(1);
}

console.log(`Validacion correcta: ${fixtures.length} formatos de pedidos y descartes comprobados.`);

function fail(name, message) {
  failures += 1;
  console.error(`[${name}] ${message}`);
}
