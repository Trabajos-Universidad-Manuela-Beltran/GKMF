import { defineConfig } from 'vitest/config';

// Pruebas de integración: requieren SQL Server con los scripts 01-04 de /database
// aplicados y las variables de conexión definidas en .env (ver README).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
