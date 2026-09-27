import { cn } from "@/lib/utils";
import { debateLanguageLabel, type AnyDebateLanguage } from "@/lib/debate-language";

// Distintivo del idioma del debate (spec 003, "Mapeo de estados a UI"): el
// código compacto a la vista y el nombre completo accesible. El `title` da
// el tooltip nativo con el mouse; el texto oculto es lo que leen los
// lectores de pantalla (un `title` no se lee de forma consistente, y el
// distintivo no es interactivo, así que no recibe foco para un tooltip).
export function LanguageBadge({ language, className }: { language: AnyDebateLanguage; className?: string }) {
  const label = debateLanguageLabel(language);
  return (
    <span
      title={`Idioma del debate: ${label}`}
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-md border border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden="true">{language}</span>
      <span className="sr-only">Idioma del debate: {label}</span>
    </span>
  );
}
