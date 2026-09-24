// Excepción tipada (coding-rules.md §5) — la data disponible todavía no
// alcanza para armar un RemotionManifest completo: falta el AudioAsset de
// algún Argument OFFICIAL (episodio no llegó a GENERATING_AUDIO/READY_FOR_RENDER
// todavía) y/o el Verdict. A propósito NO conoce EpisodeStatus (coding-rules.md
// §5, "ningún otro módulo conoce EpisodeStatus") — es un chequeo de
// completitud de datos, no de la máquina de estados de Episode; quien la
// captura (EpisodesController, vía HttpErrorFilter) decide el código HTTP.
export class ManifestNotReadyError extends Error {
  constructor(episodeId: string) {
    super(`El episodio ${episodeId} todavía no tiene todos los datos necesarios para generar el manifest (audio y/o veredicto pendientes).`);
    this.name = "ManifestNotReadyError";
  }
}
