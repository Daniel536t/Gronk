// pm2 process manager config — keeps the ASTrix server running indefinitely.
//   npm i -g pm2
//   npm run build && pm2 start ecosystem.config.cjs && pm2 save && pm2 logs
//
// dist/ must exist (npm run build) before start so the single-port prod mode
// can serve the frontend. If it doesn't, the server still runs (ASTrix API) but
// / returns the "not found" JSON until you build.
module.exports = {
  apps: [
    {
      name: "astrix",
      script: "src/server/index.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: __dirname,
      env: {
        PORT: "8787",
        NODE_ENV: "production",
      },
      max_memory_restart: "320M",
      autorestart: true,
      restart_delay: 2000,
    },
  ],
};