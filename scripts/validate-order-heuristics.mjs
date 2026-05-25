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
    customer: "Megafee",
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
    normalized: ["cloro", "soda", "fecula"]
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

  if (fixture.normalized) {
    const normalizedItems = result.items.map((item) => item.productNormalized);
    if (fixture.normalized.some((item) => !normalizedItems.includes(item))) {
      fail(fixture.name, "no se unificaron variantes plurales");
    }
  }
}

if (detectStandaloneCustomer("Don Emilio") !== "Don Emilio") {
  fail("cliente separado", "no reconoce un nombre enviado solo");
}
if (detectStandaloneCustomer("Cliente: Santa Clara") !== "Santa Clara") {
  fail("cliente etiquetado separado", "no limpia la etiqueta cliente");
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
