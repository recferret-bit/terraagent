# NestJS app image (D-24). Dev dependencies stay: boot uses @swc-node/register.
# Do not set NODE_ENV=production here — npm ci must install that register hook.
FROM node:24-bookworm
WORKDIR /src
COPY . .
# prisma generate (db postinstall) only reads DATABASE_URL; it does not connect.
# Playwright browsers are unused in this image.
RUN DATABASE_URL=postgresql://terra:terra@127.0.0.1:5432/terraagent \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    npm ci
RUN chmod +x /src/infra/docker/app-entrypoint.sh
# cwd is /src, so the register would otherwise read the root tsconfig and reject Nest decorators.
ENV SWC_NODE_PROJECT=/src/backend/app/tsconfig.json
ENTRYPOINT ["/src/infra/docker/app-entrypoint.sh"]
CMD ["node", "--import", "@swc-node/register/esm-register", "backend/app/src/main.ts"]
