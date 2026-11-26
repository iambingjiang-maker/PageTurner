FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

# Private encrypted vault directory (mount a persistent volume here in production)
RUN mkdir -p /app/data && chown -R node:node /app

USER node
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/index.js"]
