FROM oven/bun:1.3.14-slim

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY migrations ./migrations
COPY src ./src

ENV NODE_ENV=production
USER bun
EXPOSE 7421

CMD ["bun", "src/server.ts"]
