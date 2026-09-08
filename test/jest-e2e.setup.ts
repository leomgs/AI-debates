// Los tests e2e bootstrapean AppModule completo, que valida el env al
// arrancar (ver env.schema.ts). GOOGLE_API_KEY es la única requerida — acá
// le damos un valor dummy para no depender de una key real en CI/local.
process.env.GOOGLE_API_KEY ??= 'test-google-api-key';
