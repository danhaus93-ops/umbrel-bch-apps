FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install deps first for layer caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY server.js ./
COPY public ./public

# Run as the built-in unprivileged user
USER node

EXPOSE 3000
CMD ["node", "server.js"]
