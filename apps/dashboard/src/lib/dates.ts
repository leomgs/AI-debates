// Fechas del panel (AC 3.74): siempre en la zona horaria del navegador (el
// default de Intl cuando no se pasa `timeZone`), y las relativas con la
// absoluta disponible. Las pantallas del panel piden sus datos del lado del
// cliente (D11), así que estas funciones corren en el navegador; el
// parámetro `timeZone` existe solo para que los tests sean deterministas.

const INTERFACE_LOCALE = "es";

export function formatAbsoluteDate(iso: string, options: { timeZone?: string } = {}): string {
  return new Intl.DateTimeFormat(INTERFACE_LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: options.timeZone,
  }).format(new Date(iso));
}

const MINUTE = { unit: "minute", seconds: 60 } as const;

const RELATIVE_UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: "year", seconds: 365 * 24 * 60 * 60 },
  { unit: "month", seconds: 30 * 24 * 60 * 60 },
  { unit: "week", seconds: 7 * 24 * 60 * 60 },
  { unit: "day", seconds: 24 * 60 * 60 },
  { unit: "hour", seconds: 60 * 60 },
  MINUTE,
];

/** "hace 5 minutos", "ayer"… Menos de un minuto: "hace un momento". */
export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const diffSeconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return "hace un momento";

  const formatter = new Intl.RelativeTimeFormat(INTERFACE_LOCALE, { numeric: "auto" });
  // Con abs >= 60 siempre hay una unidad; el respaldo solo satisface al tipo.
  const { unit, seconds } = RELATIVE_UNITS.find((candidate) => abs >= candidate.seconds) ?? MINUTE;
  return formatter.format(Math.trunc(diffSeconds / seconds), unit);
}
