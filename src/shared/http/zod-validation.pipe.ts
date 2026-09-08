import { ArgumentMetadata, Injectable, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

// Genérico/reusable — cualquier controller que necesite validar un
// body/query/param contra un schema Zod (coding-rules.md §3: DTOs HTTP
// separados de shared/contracts/). Deja propagar el ZodError tal cual (no lo
// atrapa acá) — lo mapea HttpErrorFilter a 400 VALIDATION_ERROR.
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    return this.schema.parse(value);
  }
}
