FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY libs/shared-types/package.json libs/shared-types/

RUN npm ci

COPY tsconfig.base.json ./
COPY libs/shared-types/ libs/shared-types/
COPY apps/web/ apps/web/

ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ARG NEXT_PUBLIC_AUTH_USER_ID
ENV NEXT_PUBLIC_AUTH_USER_ID=${NEXT_PUBLIC_AUTH_USER_ID}

RUN npm run build -w @tw-portfolio/shared-types \
 && npm run build -w @tw-portfolio/web

FROM node:22-alpine

RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
COPY --from=build /app/apps/web/public/ apps/web/public/
COPY --from=build /app/libs/shared-types/dist/ libs/shared-types/dist/

RUN chown -R app:app /app
USER app

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1

CMD ["node", "apps/web/server.js"]
