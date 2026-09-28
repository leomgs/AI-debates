// Helper de tests (spec 004, AC 4.26): formas de voseo que no pueden
// aparecer en ningún prompt del backend. Lo usan los specs que capturan el
// prompt real enviado al SDK (agentes, juez, evaluadoras y research) y el de
// shared/personas. Excluido del build (tsconfig.build.json).
//
// Lista: las formas que había en los prompts antes de la spec 004 y sus
// vecinas más probables. Delimitadas por letras Unicode, no por \b: \b trata
// las vocales acentuadas como no-palabra.
const VOSEO_FORMS = [
  // Presente
  "sos",
  "querés",
  "podés",
  "tenés",
  "debés",
  "sabés",
  "hacés",
  "decís",
  // Imperativo
  "presentá",
  "generá",
  "devolvé",
  "recordá",
  "emití",
  "evaluá",
  "citá",
  "segmentá",
  "clasificá",
  "extraé",
  "usá",
  "reforzá",
  "ajustá",
  "quedáte",
  "quedate",
  "hacé",
  "tené",
  "decí",
  "evitá",
  "mantené",
  "respondé",
  "escribí",
  "indicá",
  "señalá",
  "revisá",
  "asegurate",
  "asegurá",
  "fijate",
];

export const VOSEO = new RegExp(`(?<!\\p{L})(${VOSEO_FORMS.join("|")})(?!\\p{L})`, "iu");
