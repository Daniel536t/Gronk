// pm2 process manager config — keeps the game server running indefinitely.
//   npm i -g pm2
//   npm run build && pm2 start ecosystem.config.cjs && pm2 save && pm2 logs
//
// dist/ must exist (npm run build) before start so the single-port prod mode
// can serve the frontend. If it doesn't, the server still runs (API + MCP) but
// / returns the "not found" JSON until you build.
//
// BOTS is read from the environment so the same config serves both modes:
//   pm2 start ecosystem.config.cjs                 # scripted fallback (default)
//   BOTS=trueforge pm2 start ecosystem.config.cjs  # TrueForge agents (M4)
//   BOTS=trueforge pm2 restart gronks-hoard        # switch an existing app
//
// TrueForge Mode also needs the harness up + agents provisioned — see README
// "TrueForge Mode (M4)". The trueforge-harness app below keeps the harness
// alive too; configure a model-provider API key in its UI once, first.
module.exports = {
  apps: [
    {
      name: "gronks-hoard",
      script: "src/server/index.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: __dirname,
      env: {
        PORT: "8787",
        BOTS: process.env.BOTS ?? "scripted", // fallback-mode default
        NODE_ENV: "production",
      },
      max_memory_restart: "320M",
      autorestart: true,
      restart_delay: 2000,
      // Survive server reboots:
      //   pm2 startup   (copy the printed command)
    },
    {
      // TrueForge agent harness (M4). Needs a model-provider API key configured
      // in the TrueForge UI once. Optional — scripted mode doesn't use it.
      name: "trueforge-harness",
      script: "npx",
      args: "--yes @truefoundry/trueforge --port 8790",
      cwd: __dirname,
      max_memory_restart: "512M",
      autorestart: true,
      restart_delay: 3000,
    },
  ],
};