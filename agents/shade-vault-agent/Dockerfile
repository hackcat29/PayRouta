ARG SOURCE_DATE_EPOCH=0

FROM node:22-alpine@sha256:92d51e5f20b7ff58faa5a969af1a1cec6cbec3fbff7e0f523242b9b5c85ad887 AS build
ARG SOURCE_DATE_EPOCH=0
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --include=dev
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine@sha256:92d51e5f20b7ff58faa5a969af1a1cec6cbec3fbff7e0f523242b9b5c85ad887
ARG SOURCE_DATE_EPOCH=0
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
CMD ["node", "dist/index.js"]
