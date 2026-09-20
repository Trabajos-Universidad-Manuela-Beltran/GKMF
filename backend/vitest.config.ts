import { defineConfig } from 'vitest/config';

// Pruebas unitarias y de API con dependencias simuladas: no requieren base de datos.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // El arranque (señales del sistema) y el cableado real con SQL Server se validan en las pruebas de integración.
      exclude: ['src/server.ts', 'src/composicion.ts', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
