import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // La salida debe pasar por el logger estructurado (con redacción de datos sensibles).
      'no-console': 'error',
      // Evita comparaciones laxas que ocultan errores de tipos.
      eqeqeq: ['error', 'always'],
      // Los parámetros no usados deben iniciar con guion bajo (p. ej. _req).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Prohíbe construir SQL dinámico por accidente con eval / Function.
      'no-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    // Los scripts de utilidad sí pueden escribir en la consola.
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
