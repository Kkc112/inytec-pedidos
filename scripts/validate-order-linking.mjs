import { OrderLinker } from "../bot/order-linker.mjs";

const fixtures = [
  {
    name: "cliente despues del pedido mismo vendedor",
    blocks: [block("3 cloro\n2 calcio chino", "Ana", 0), block("Don Emilio", "Ana", 20)],
    expected: { actions: ["created", "updated"], customer: "Don Emilio", items: 2, review: false }
  },
  {
    name: "cliente antes del pedido",
    blocks: [block("Santa Clara", "Ana", 0), block("2 sal\n1 cloro", "Ana", 30)],
    expected: { actions: ["customer_waiting", "created"], customer: "Santa Clara", items: 2, review: false }
  },
  {
    name: "molino antes del pedido",
    blocks: [block("Molino", "Daniel", 0), block("Para mañana necesito 500 litros de Cloro", "Daniel", 30)],
    expected: { actions: ["customer_waiting", "created"], customer: "El Molino S.R.L.", items: 1, review: false }
  },
  {
    name: "molino despues de cantidad de litros sin producto",
    blocks: [block("Para mañana 700 litros\nHola Daniel", "Daniel", 0), block("Molinos Fénix", "Daniel", 20)],
    expected: { actions: ["created", "updated"], customer: "El Molino S.R.L.", items: 1, review: false }
  },
  {
    name: "productos habituales de don emilio antes del cliente",
    blocks: [block("1 Pico\n1 Pinza mohr\n2 Legias\n1 Fenolftaleina", "Daniel", 0), block("Don Emilio", "Daniel", 20)],
    expected: { actions: ["created", "updated"], customer: "Don Emilio", items: 4, review: false }
  },
  {
    name: "nuestros pagos mal escrito despues del pedido",
    blocks: [block("2 calcio chino", "Daniel", 0), block("Nuestro pagos", "Daniel", 25)],
    expected: { actions: ["created", "updated"], customer: "Nuestros Pagos", items: 1, review: false }
  },
  {
    name: "cliente aclarado por otra persona",
    blocks: [block("4 cloro", "Ana", 0), block("Lacteos Centro", "Beto", 25)],
    expected: { actions: ["created", "updated"], customer: "Lacteos Centro", items: 1, review: true }
  },
  {
    name: "productos en mensajes separados",
    blocks: [block("3 cloro", "Ana", 0), block("2 calcio chino", "Ana", 40), block("Don Emilio", "Ana", 70)],
    expected: { actions: ["created", "updated", "updated"], customer: "Don Emilio", items: 2, review: false }
  },
  {
    name: "megafee se guarda como megafe",
    blocks: [block("3 cloro", "Ana", 0), block("Megafee", "Ana", 20)],
    expected: { actions: ["created", "updated"], customer: "Megafe", items: 1, review: false }
  },
  {
    name: "pedido completo ajeno no completa un pendiente",
    blocks: [block("3 cloro", "Ana", 0), block("1 sal\nSanta Clara", "Beto", 20)],
    expected: { actions: ["created", "created"], customer: "Santa Clara", items: 1, review: false }
  },
  {
    name: "audio reenviado seguido de cliente",
    blocks: [block("", "Ana", 0, [{ kind: "audio" }]), block("Lacteos Andrea", "Ana", 20)],
    expected: { actions: ["created", "updated"], customer: "Lacteos Andrea", items: 0, review: true }
  },
  {
    name: "imagen con pedido explicito y cliente en bloque",
    blocks: [block("Pedido San Bernardo", "Ana", 0, [{ kind: "image" }])],
    expected: { actions: ["created"], customer: "San Bernardo", items: 0, review: true }
  },
  {
    name: "imagen con cliente entra para revision",
    blocks: [block("Bartolini", "Hernan", 0, [{ kind: "image" }])],
    expected: { actions: ["created"], customer: "Bartolini", items: 0, review: true }
  },
  {
    name: "foto de pago seguida de cliente no genera pedido",
    blocks: [block("", "Mariano", 0, [{ kind: "image" }], [{ document_type: "payment" }]), block("Jacki", "Mariano", 20)],
    expected: { actions: ["ignored", "customer_waiting"], noDetection: true }
  },
  {
    name: "pdf de ticket no genera pedido",
    blocks: [block("El tupa\nTicket.pdf", "Mariano", 0, [{ kind: "pdf" }])],
    expected: { actions: ["ignored"], noDetection: true }
  },
  {
    name: "consulta de precios no genera pedido",
    blocks: [block("Liencillo\nCalcio chino\nSoda\nCloro\nDetergente\nAcido\nSal\nSal nitro\nFiltro de leche\nDon fortunato\nLe pasaron precio a don fortunato?", "Mariano", 0)],
    expected: { actions: ["ignored"], noDetection: true }
  }
];

let failures = 0;

for (const fixture of fixtures) {
  const linker = new OrderLinker();
  const results = fixture.blocks.map((entry) => linker.evaluate(entry));
  const actions = results.map((result) => result.action);
  const final = [...results].reverse().find((result) => result.detection)?.detection;

  if (JSON.stringify(actions) !== JSON.stringify(fixture.expected.actions)) {
    fail(fixture.name, `acciones obtenidas ${actions.join(", ")}`);
  }
  if (fixture.expected.noDetection) {
    if (final) fail(fixture.name, "genero un pedido cuando debia ignorarse");
    continue;
  }
  if (final?.customerGuess !== fixture.expected.customer) {
    fail(fixture.name, `cliente obtenido "${final?.customerGuess}"`);
  }
  if (final?.items.length !== fixture.expected.items) {
    fail(fixture.name, `productos obtenidos ${final?.items.length}`);
  }
  if (final?.needsReview !== fixture.expected.review) {
    fail(fixture.name, `revision obtenida ${final?.needsReview}`);
  }
}

if (failures) {
  console.error(`Validacion de mensajes separados fallida: ${failures} casos con error.`);
  process.exit(1);
}

console.log(`Validacion correcta: ${fixtures.length} secuencias de mensajes separados comprobadas.`);

function block(text, author, seconds, attachments = [], mediaIntelligence = []) {
  const instant = new Date(Date.UTC(2026, 4, 25, 12, 0, seconds)).toISOString();
  return {
    id: `order_${author}_${seconds}`,
    chatId: "grupo@g.us",
    authorId: `${author}@lid`,
    authorName: author,
    startedAt: instant,
    endedAt: instant,
    text,
    messages: [{ body: text, attachments, raw: { mediaIntelligence } }]
  };
}

function fail(name, message) {
  failures += 1;
  console.error(`[${name}] ${message}`);
}
