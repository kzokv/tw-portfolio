FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY libs/domain/package.json libs/domain/
COPY libs/shared-types/package.json libs/shared-types/

RUN npm ci

COPY tsconfig.base.json ./
COPY libs/ libs/
COPY apps/api/ apps/api/

RUN npm run build -w @tw-portfolio/domain \
 && npm run build -w @tw-portfolio/shared-types \
 && npm run build -w @tw-portfolio/api

FROM node:24-alpine

RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/libs/domain/package.json libs/domain/
COPY --from=build /app/libs/shared-types/package.json libs/shared-types/

RUN npm ci --omit=dev

COPY --from=build /app/apps/api/dist/ apps/api/dist/
COPY --from=build /app/libs/domain/dist/ libs/domain/dist/
COPY --from=build /app/libs/shared-types/dist/ libs/shared-types/dist/
COPY db/migrations/ db/migrations/

RUN chown -R app:app /app
USER app

ENV NODE_ENV=production
EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health/live || exit 1

CMD ["node", "apps/api/dist/server.js"]
