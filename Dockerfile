# Образ Node берётся из Docker Hub. Если он недоступен с сервера, задайте зеркало:
#   NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim в deploy/.env
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS web
WORKDIR /src
COPY shared shared
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci --no-audit --no-fund
COPY web web
RUN cd web && npm run build

FROM ${NODE_IMAGE}
# ffmpeg переводит записи голоса в MP3 (server/src/audio.js); берётся из пакетов Debian при сборке образа.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8095 DATA_DIR=/data WEB_DIR=/app/web/dist
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund
COPY shared shared
COPY server/src server/src
COPY server/bin server/bin
COPY server/migrations server/migrations
COPY --from=web /src/web/dist web/dist
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/server
EXPOSE 8095
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8095/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
