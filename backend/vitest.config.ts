import { defineConfig } from 'vitest/config';

// Pruebas unitarias y de API con dependencias simuladas: no requieren base de datos.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Se excluye lo que solo tiene sentido contra SQL Server real y se valida en las pruebas de integración
      // (npm run test:integracion:cov): el arranque (señales del sistema), el cableado real y los repositorios, que
      // son SQL parametrizado sin lógica que simular.
      exclude: ['src/server.ts', 'src/composicion.ts', 'src/**/*.d.ts', 'src/**/*.repositorio.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
