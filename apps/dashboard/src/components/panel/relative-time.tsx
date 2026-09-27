import { formatAbsoluteDate, formatRelativeDate } from "@/lib/dates";

// Fecha relativa con la absoluta disponible (AC 3.74). La absoluta va a la
// vista en texto chico (así también se ve con teclado o en pantallas
// táctiles, donde un `title` no aparece), además del `title` con el mouse.
// Solo se usa en componentes que renderizan datos pedidos desde el
// navegador (D11), así que la zona horaria es siempre la del navegador y no
// hay diferencias de hidratación con el render de servidor.
export function RelativeTime({ iso, now }: { iso: string; now?: Date }) {
  const absolute = formatAbsoluteDate(iso);
  return (
    <time dateTime={iso} title={absolute}>
      {formatRelativeDate(iso, now)}
      <span className="text-muted-foreground/80"> · {absolute}</span>
    </time>
  );
}
