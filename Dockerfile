FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS runtime

WORKDIR /workspace
ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/
COPY --from=build --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/dist /app/dist
COPY --chown=node:node README.md LICENSE /app/
COPY --chown=node:node docs/claude-md-snippet.md /app/docs/claude-md-snippet.md

USER node

ENTRYPOINT ["node", "/app/dist/cli/main.js"]
CMD ["serve"]
