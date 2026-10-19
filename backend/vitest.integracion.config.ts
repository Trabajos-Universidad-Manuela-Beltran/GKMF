import { defineConfig } from 'vitest/config';

// Pruebas de integración: requieren SQL Server con los scripts 01-04 de /database
// aplicados y las variables de conexión definidas en .env (ver README).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/**/*.d.ts'],
      // Solo informe (sin umbral): complementa la cobertura unitaria midiendo la capa de datos con SQL Server real.
      reporter: ['text-summary', 'text'],
    },
  },
});
