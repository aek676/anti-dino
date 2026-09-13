# Fresha: cómo obtener los huecos disponibles

Fresha no tiene API pública. El widget de reservas habla con `POST https://www.fresha.com/graphql`
usando *persisted queries*: se envía el nombre de la operación y su hash SHA-256, nunca el texto
de la query. No hace falta login ni cookie; el estado vive en un `cartId` que devuelve la
inicialización. Es una UI dirigida por servidor: cada pantalla trae `action.id` opacos que se
reenvían tal cual para avanzar.

## Peticiones

Cabeceras: `content-type: application/json`, `x-client-platform: web`,
`x-graphql-operation-name: <op>`, un `user-agent` de navegador.

Cuerpo: `{"operationName", "variables", "extensions": {"persistedQuery": {"version": 1, "sha256Hash"}}}`.

| Operación | Hash (build `3ec6cbda…`, sep 2026) |
|---|---|
| `BookingFlow_Initialize_Mutation` | `02d5d8ce34389c6f0a8fb062c0a6b30c1749508c053bd79b4e396b03d5d0014e` |
| `BookingFlow_ActionButtonPressed_Mutation` | `93c58971c704f87497d4cbf391df04eb0da5275116e27345866052f8523904f9` |
| `BookingFlow_TimeScrollEnd_Mutation` | `05d737a1ff85f3304b76ed1bb90732448abe03824ab85c926b961f1436e7a687` |

Los hashes cambian cuando Fresha despliega. Se recuperan buscando `name:"BookingFlow_…"` en los
chunks JS listados en `/assets/_next/static/<buildId>/_buildManifest.js` para la ruta
`/[routeCtx]/a/[locationSlug]/booking`.

## Flujo

1. **Initialize**: variables `{withRecommendedServices:false, input:{locationSlug, referer:<url>,
   options:{…todo null, isFromLinkBuilder:true, shouldShowAllEmployees:false}, shouldAutoContinue:true,
   capabilities:[…]}}`. `referer` es obligatorio (String!). Devuelve `cartId` y
   `screenServices.categories[].items[]` con `secondaryAction` ("Add service").
2. **ActionButtonPressed** con `{id, cartId, shouldAutoContinue, withRecommendedServices:false}`.
   Se llama en cadena:
   - `secondaryAction.id` del servicio (`onScreenServicesServiceVariantAdd`, `bookableId: "sv:18605549"`).
   - `continueAction.id` de la pantalla de servicios → `BookingFlowScreenEmployee`.
   - `employees[].action.id` (`onScreenEmployeeSet`, `employeeId`) y luego `continueAction.id` → `BookingFlowScreenTime`.
   - `dates[].action.id` (`onScreenTimeDaySelectorDateSet`, `date: "YYYY-MM-DD"`) → `day.timeslots[]`.
3. **TimeScrollEnd** con `{input:{leftMostDate, locationSlug, shouldAutoContinue, cartId}}` carga más
   días más allá de los 31 iniciales.

La pantalla activa es la clave `screen<Nombre>` cuyo `__typename` coincide con `screen.__typename`;
el resto llevan solo `__typename`. Un `toasts[]` con `BookingFlowToastError` indica que la acción no
encajaba con el estado del carrito (por ejemplo, un modal abierto).

## Datos de LaClínica

- `locationSlug`: `laclinica-la-gangosa-bulevar-ciudad-de-vicar-gg4e0gad`, `locationId` 1394665, provider 1324442.
  `Initialize` acepta en `locationSlug` tanto el slug como el `locationId` numérico (comprobado sep 2026).
- Servicio "Corte de pelo": catalog `s:16131271`, variante `sv:18605549`, 30 min.
- Empleados: Sergio `5236325`, Elvis `3182031`.
- `dates[]` trae 31 días con `isAvailableToBeBooked`; solo hay que abrir los días marcados.
- Los huecos vienen como `time: "12:15"` (hora local del centro) y `action.id` con `time` en
  segundos desde medianoche. No incluyen zona horaria; hay que asumir `Europe/Madrid`.
