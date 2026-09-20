# syntax=docker/dockerfile:1

# ---------- 1) Dependencias (con las de desarrollo, para poder compilar) ----------
FROM node:24-alpine AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- 2) Compilación y poda de dependencias de desarrollo ----------
FROM dependencias AS compilacion
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- 3) Imagen final: mínima, sin herramientas de compilación, usuario no root ----------
FROM node:24-alpine AS produccion
ENV NODE_ENV=production
WORKDIR /app
COPY --from=compilacion --chown=node:node /app/node_modules ./node_modules
COPY --from=compilacion --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
