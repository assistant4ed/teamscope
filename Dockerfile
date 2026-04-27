# ---- build stage ------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Vite bakes env vars at build time. Railway passes service vars as build
# args automatically when a matching ARG is declared.
ARG GEMINI_API_KEY
ENV GEMINI_API_KEY=$GEMINI_API_KEY

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---- runtime stage ----------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Copy only what's needed to run
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=build /app/dist        ./dist
COPY --from=build /app/server      ./server
COPY --from=build /app/migrations  ./migrations
COPY --from=build /app/tsconfig*.json ./

# tsx runs the TS server file directly in prod — small and simple
RUN npm install --no-save tsx@4

EXPOSE 3000
CMD ["npx", "tsx", "server/index.ts"]
