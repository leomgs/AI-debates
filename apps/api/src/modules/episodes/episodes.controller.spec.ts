import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { EpisodesController } from "./episodes.controller";

// API-10: Express prueba las rutas en el orden en que Nest las registra, que
// es el de declaración de los métodos del controller. La ruta genérica
// `:id/actions/:action` (unknownAction) matchea cualquier acción, así que
// una acción nueva declarada debajo de ella nunca llegaría a su handler:
// respondería 400 VALIDATION_ERROR (o el pipe la dejaría pasar y
// unknownAction la rechazaría igual). Este test fija que sea el último @Post.
describe("EpisodesController — orden de las rutas POST (API-10)", () => {
  const prototype = EpisodesController.prototype as unknown as Record<string, object>;
  const postMethods = Object.getOwnPropertyNames(prototype).filter((name) => {
    const handler = prototype[name];
    return (
      name !== "constructor" &&
      typeof handler === "function" &&
      Reflect.getMetadata(METHOD_METADATA, handler) === RequestMethod.POST &&
      Reflect.getMetadata(PATH_METADATA, handler) !== undefined
    );
  });
  const pathOf = (name: string) => Reflect.getMetadata(PATH_METADATA, prototype[name]) as string;

  it("encuentra los @Post del controller (sanity check de la metadata de Nest)", () => {
    expect(postMethods).toEqual(expect.arrayContaining(["create", "approve", "regenerateVerdict", "unknownAction"]));
    expect(pathOf("unknownAction")).toBe(":id/actions/:action");
  });

  it("unknownAction es el último método con @Post", () => {
    expect(postMethods[postMethods.length - 1]).toBe("unknownAction");
  });

  it("toda ruta de acción literal se declara antes que la genérica", () => {
    const actionPaths = postMethods.map(pathOf).filter((path) => path.startsWith(":id/actions/"));
    expect(actionPaths.indexOf(":id/actions/:action")).toBe(actionPaths.length - 1);
    expect(actionPaths.length).toBeGreaterThan(1);
  });
});
