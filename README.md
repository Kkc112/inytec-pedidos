# Inytec WhatsApp MVP

Primer MVP para convertir el historial del grupo interno de WhatsApp en candidatos de pedido revisables.

## Qué hace ahora

- Lee `whatsapp_export/_chat.txt`.
- Detecta mensajes, autores, fechas y adjuntos.
- Agrupa mensajes consecutivos del mismo vendedor en bloques conversacionales.
- Marca bloques que parecen pedidos.
- Extrae una primera versión de cliente, productos, cantidades, unidades, notas y evidencia original.
- Genera JSON para revisar antes de conectar WhatsApp en vivo.
- Muestra una app móvil/PWA para revisar pedidos y cambiar estados.

## Ejecutar

```bash
npm run import:whatsapp
```

Salidas:

- `data/imported/summary.json`: resumen del historial.
- `data/imported/messages.json`: mensajes parseados.
- `data/imported/blocks.json`: bloques conversacionales.
- `data/imported/order-candidates.json`: pedidos candidatos para revisión.

## Revisar patrones y catalogos

Para generar una lista revisable de clientes y productos desde el historial:

```bash
npm run analyze:history
```

Salidas locales:

- `data/analysis/history-report.json`: totales y principales clientes/productos candidatos.
- `data/analysis/customers-review.csv`: nombres de clientes candidatos para depurar.
- `data/analysis/products-review.csv`: productos candidatos para normalizar.
- `data/analysis/patterns-review.md`: ejemplos reales de escritura de pedidos.

Para comprobar las reglas de lectura de pedidos escritos:

```bash
npm run validate:orders
```

Estos catalogos son de revision: no se cargan automaticamente como datos definitivos hasta limpiar nombres ambiguos, pagos y mensajes internos.

## Extraer pedidos con OpenAI

Prueba local sin usar API:

```bash
npm run extract:orders:dry
```

Extracción real:

```bash
$env:OPENAI_API_KEY="tu_api_key"
npm run extract:orders -- --limit=25
```

Variables útiles:

- `OPENAI_MODEL`: modelo a usar. Por defecto usa `gpt-4.1-mini`.
- `--limit=25`: cantidad de candidatos a procesar.
- `--offset=100`: desde qué candidato empezar.
- `--input=...`: archivo de entrada.
- `--output=...`: archivo de salida.

Salidas:

- `data/imported/extracted-orders.json`
- `data/imported/extracted-orders.summary.json`

## App móvil

```bash
npm run dev
```

Abrir:

```text
http://localhost:3000
```

La app muestra pedidos, filtros por estado, detalle, adjuntos detectados y cambios de estado. En esta etapa lee `data/imported/extracted-orders.json`; el siguiente paso es conectarla a Supabase Realtime.

## Supabase y tiempo real

1. Crear un proyecto en Supabase.
2. Ejecutar `sql/001_initial_schema.sql` en el SQL editor.
3. Crear `.env` a partir de `.env.example`.
4. Completar:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

5. Cargar los pedidos extraídos:

```bash
npm run seed:supabase
```

Con esas variables configuradas, la app deja de usar JSON local y pasa a leer/escribir en Supabase. Los cambios sobre `orders` y `order_items` se reflejan en vivo en los celulares conectados.

Para despliegue completo, ver:

```text
DEPLOY.md
```

## Bot de WhatsApp

El bot se vincula como WhatsApp Web y funciona en modo silencioso: no responde en el grupo.

```bash
npm run bot:whatsapp
```

Primera ejecución:

1. Escanear el QR desde WhatsApp Business > Dispositivos vinculados.
2. Agregar el número al grupo interno.
3. Configurar en `.env` al menos uno:

```text
WHATSAPP_GROUP_NAME=inytec I&S
WHATSAPP_GROUP_JID=
```

Si no configurás grupo, procesa todos los grupos donde esté ese número. Para producción conviene fijar `WHATSAPP_GROUP_JID`.

El bot guarda:

- mensajes en `whatsapp_messages`
- adjuntos en `media_files` y `data/live/media`
- pedidos candidatos directamente en `orders` y `order_items`

El bot tambien admite pedidos enviados en partes. Durante tres minutos puede unir productos y cliente enviados en mensajes distintos; si otra persona informa el cliente, lo vincula y deja el pedido marcado para revision. Si el bot se reinicia, vuelve a revisar los pedidos recientes sin cliente para recuperar esas asociaciones.

Si Supabase no está configurado, deja logs locales en `data/live`.

## Base de datos

El esquema inicial para Supabase/PostgreSQL está en:

```text
sql/001_initial_schema.sql
```

## Próximo paso

Conectar la extracción de cada `order_candidate` con OpenAI para devolver JSON validado, y luego cargar esos candidatos en Supabase para mostrarlos en un dashboard.
