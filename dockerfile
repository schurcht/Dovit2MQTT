FROM alpine:latest

RUN apk add --update --no-cache \
    nodejs \
    npm

WORKDIR /app
COPY . .
RUN npm ci

CMD ["node", "/app/index.js"]