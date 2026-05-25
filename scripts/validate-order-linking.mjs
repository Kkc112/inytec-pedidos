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
    name: "cliente aclarado por otra persona",
    blocks: [block("4 cloro", "Ana", 0), block("Lacteos Centro", "Beto", 25)],
    expected: { actions: ["created", "updated"], customer: "Lacteos Centro", items: 1, review: true }
  },
  {
    name: "productos en mensajes separados",
    blocks: [block("3 cloro", "Ana", 0), block("2 calcio", "Ana", 40), block("Don Emilio", "Ana", 70)],
    expected: { actions: ["created", "updated", "updated"], customer: "Don Emilio", items: 2, review: false }
  },
  {
    name: "pedido completo ajeno no completa un pendiente",
    blocks: [block("3 cloro", "Ana", 0), block("1 sal\nSanta Clara", "Beto", 20)],
    expected: { actions: ["created", "created"], customer: "Santa Clara", items: 1, review: false }
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

function block(text, author, seconds) {
  const instant = new Date(Date.UTC(2026, 4, 25, 12, 0, seconds)).toISOString();
  return {
    id: `order_${author}_${seconds}`,
    chatId: "grupo@g.us",
    authorId: `${author}@lid`,
    authorName: author,
    startedAt: instant,
    endedAt: instant,
    text,
    messages: [{ body: text, attachments: [] }]
  };
}

function fail(name, message) {
  failures += 1;
  console.error(`[${name}] ${message}`);
}
