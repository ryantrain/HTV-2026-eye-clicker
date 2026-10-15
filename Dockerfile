# Build/check environment. Desktop interaction runs on the host OS.
FROM node:24-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libxtst-dev libpng++-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node . .
RUN npm run typecheck && npm run lint && npm test

CMD ["npm", "run", "typecheck"]
