// Efecto de import para auth-production.e2e-spec.ts: fija NODE_ENV=production
// ANTES de que ese archivo importe AppModule. ConfigModule.forRoot valida
// process.env al evaluarse el decorador de AppModule (o sea, al importarlo),
// así que setearlo dentro del test llegaría tarde. Jest le da a cada archivo
// de test su propia copia de process.env: no se filtra a los otros e2e.
process.env.NODE_ENV = 'production';
process.env.AUDIO_SIGNING_SECRET = 'e2e-production-audio-secret';
