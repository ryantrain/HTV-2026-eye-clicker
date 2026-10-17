FROM node:24-bookworm AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run web:build
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
# Install locked production dependencies; native desktop scripts are not needed on the server.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
USER node
EXPOSE 8787
CMD ["node", "server/index.mjs"]
