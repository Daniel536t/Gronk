# Gronk's Hoard — always-on game server (built as a Docker image for
# Fly.io / Render / any container host). Builds the frontend and serves the
# whole game (HTML + API + MCP) on ONE port.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 BOTS=scripted
COPY package*.json ./
RUN npm ci --omit=dev && npm i -g pm2 typescript tsx
COPY --from=build /app/dist ./dist
COPY src ./src
COPY .env ./
# Run under pm2 so it restarts on crashes / restarts.
CMD ["pm2-runtime", "start", "ecosystem.config.cjs", "--only", "gronks-hoard"]