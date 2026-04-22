FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json .
COPY src ./src
EXPOSE 3001
ENV NODE_ENV=production
CMD ["npx", "ts-node", "--transpile-only", "src/server.ts"]
