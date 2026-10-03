# Transport Manager – De Vreugd Transport
# Node 22 (LTS) met de ingebouwde node:sqlite-database. Eén externe
# dependency: web-push (pushmeldingen naar chauffeurs).
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    TZ=Europe/Amsterdam \
    NODE_NO_WARNINGS=1

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY . .
RUN sed -i "s/\r$//" docker-entrypoint.sh && chmod +x docker-entrypoint.sh \
 && mkdir -p /data && chown -R node:node /data /app

# Niet als root draaien binnen de container.
USER node

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
