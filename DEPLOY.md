# Despliegue

Para usar la app desde cualquier lugar hace falta separar tres piezas:

1. Supabase: base de datos y realtime.
2. Vercel: app web/PWA.
3. Railway: bot conectado a WhatsApp Web corriendo 24/7 con almacenamiento persistente.

## 1. Supabase

1. Crear proyecto en Supabase.
2. Abrir SQL Editor.
3. Ejecutar `sql/001_initial_schema.sql`.
4. Copiar estas claves:
   - Project URL
   - anon public key
   - service_role key

Supabase Realtime usa Postgres Changes para escuchar cambios de tablas. El SQL ya agrega `orders` y `order_items` a la publication `supabase_realtime`.

## 2. Vercel

Subir este proyecto a GitHub y luego importarlo en Vercel como proyecto Next.js.

Variables en Vercel:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Build command:

```text
npm run build
```

Output/framework:

```text
Next.js
```

Notas:

- No subir `.env`.
- Las variables `NEXT_PUBLIC_*` deben existir en Vercel al momento del build.
- La app desplegada debe leer y escribir en Supabase, no en `data/live`.

## 3. Railway para el bot

El bot no debe correr en Vercel. Necesita un proceso persistente para mantener la sesión de WhatsApp Web.

El archivo `railway.json` hace que Railway use automaticamente este contenedor:

```text
Dockerfile.bot
```

Variables en Railway:

```text
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
WHATSAPP_GROUP_NAME=inytec I&S
WHATSAPP_GROUP_JID=
BOT_AUTH_DIR=/data/whatsapp-web-auth
BOT_MEDIA_DIR=/data/live/media
BOT_ORDER_DEBOUNCE_MS=5000
BOT_LOG_LEVEL=silent
```

Configurar un volumen persistente montado en:

```text
/data
```

Esto es necesario para conservar la sesion de WhatsApp Web entre reinicios.

Primera conexión:

1. Abrir la direccion publica de Railway terminada en `/qr`.
2. Escanear el QR con WhatsApp Business del numero bot.
3. Verificar en los logs de Railway:

```text
Bot conectado. Modo silencioso activo.
```

4. Enviar pedido de prueba al grupo.
5. Confirmar que aparece en Supabase y en la app de Vercel.

## Orden recomendado

1. Supabase.
2. Vercel.
3. Railway.
4. Probar con grupo de prueba.
5. Cambiar `WHATSAPP_GROUP_NAME` o `WHATSAPP_GROUP_JID` al grupo real.

## Alternativa estable con Twilio WhatsApp

Twilio usa WhatsApp oficial y no lee grupos normales de WhatsApp. Este modo sirve para mensajes directos al numero de Twilio, o para que el equipo reenvie el pedido al numero bot.

Webhook para Twilio:

```text
https://inytec-pedido.vercel.app/api/twilio/whatsapp
```

Si se configura `TWILIO_WEBHOOK_TOKEN`, usar:

```text
https://inytec-pedido.vercel.app/api/twilio/whatsapp?token=VALOR_SECRETO
```

En Twilio Console:

1. Abrir WhatsApp Sender o Messaging Sandbox.
2. En inbound webhook / when a message comes in, pegar la URL.
3. Metodo: `POST`.
4. Enviar un WhatsApp directo al numero de Twilio con formato de pedido.
5. Abrir el dashboard y verificar que aparezca.
