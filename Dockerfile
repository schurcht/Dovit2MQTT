FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY dovit2mqtt.js bridge.js dovit.js ./
COPY modules ./modules
COPY configuration.json ./
USER node
CMD ["node", "dovit2mqtt.js"]
