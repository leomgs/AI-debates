// Los tests e2e bootstrapean AppModule completo, que valida el env al
// arrancar (ver env.schema.ts). GOOGLE_API_KEY y TAVILY_API_KEY son las
// requeridas — acá les damos un valor dummy para no depender de keys reales
// en CI/local.
process.env.GOOGLE_API_KEY ??= 'test-google-api-key';
process.env.TAVILY_API_KEY ??= 'test-tavily-api-key';
