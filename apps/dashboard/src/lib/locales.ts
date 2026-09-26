// Idiomas de la interfaz del showcase (D16). Lista propia del dashboard: no
// se deriva de DebateLanguage, que es el idioma del contenido de cada debate
// (Restricciones técnicas de la spec 003, "Tipos generados"). En F4 el único
// valor válido es "es"; sumar "en" o "pt" es agregarlos acá (más sus textos).
export const SHOWCASE_LOCALES = ["es"] as const;

export type ShowcaseLocale = (typeof SHOWCASE_LOCALES)[number];

export const DEFAULT_SHOWCASE_LOCALE: ShowcaseLocale = "es";

export function isShowcaseLocale(value: string): value is ShowcaseLocale {
  return (SHOWCASE_LOCALES as readonly string[]).includes(value);
}
