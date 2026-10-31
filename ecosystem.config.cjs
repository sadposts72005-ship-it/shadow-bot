module.exports = {
  apps: [
    {
      name: "shadow-bot",
      script: "./index.js",
      cwd: "D:\\Shadow-Bot",
      watch: false,
      max_memory_restart: "500M",
      autorestart: true,
      restart_delay: 4000,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
