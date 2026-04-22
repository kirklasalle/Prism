// PM2 Process Manager Configuration for PRISM
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 stop prism
//   pm2 restart prism
//   pm2 logs prism
//   pm2 monit
module.exports = {
    apps: [
        {
            name: "prism",
            script: "dist/src/index.js",
            cwd: __dirname,
            env: {
                NODE_ENV: "production",
                PRISM_MODE: "server",
                PRISM_ENV_PROFILE: "dev",
                PRISM_DASHBOARD_PORT: "7070",
            },
            env_production: {
                NODE_ENV: "production",
                PRISM_ENV_PROFILE: "prod",
            },
            // Restart policy
            max_restarts: 10,
            min_uptime: "10s",
            restart_delay: 3000,
            autorestart: true,
            // Graceful shutdown
            kill_timeout: 5000,
            listen_timeout: 10000,
            // Watch (disabled by default — enable for development)
            watch: false,
            ignore_watch: ["node_modules", "tmp", "prism-output", "logs", "*.db", "*.sq", "*.sq2"],
            // Logging
            error_file: "logs/prism-error.log",
            out_file: "logs/prism-out.log",
            merge_logs: true,
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            // Memory limit — restart if exceeded (512 MB)
            max_memory_restart: "512M",
            // Node.js options
            node_args: "--max-old-space-size=512",
        },
    ],
};
