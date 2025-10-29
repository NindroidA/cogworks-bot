 
module.exports = {
  apps: [
    {
      name: 'cogworks-bot',
      script: './src/index.ts',
      interpreter: 'bun',  // Use Bun runtime (fallback to node if bun not available)
      
      // Auto-restart configuration
      autorestart: true,
      watch: false,                 // Set to true if you want to restart on file changes (dev only)
      max_memory_restart: '1000M',  // Restart if memory exceeds 1000MB (1GB)
      max_restarts: 10,             // Max restarts within restart_delay
      restart_delay: 4000,          // Delay between restarts (ms)
      
      // Execution mode
      instances: 1,
      exec_mode: 'fork',
      
      // Environment variables
      env: {
        NODE_ENV: 'production',
        RELEASE: 'prod'
      },
      env_development: {
        NODE_ENV: 'development',
        RELEASE: 'dev'
      },
      
      // Logging
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Advanced options
      listen_timeout: 10000,
      kill_timeout: 5000,
      wait_ready: false,
      
      // Restart strategies
      exp_backoff_restart_delay: 100,
      min_uptime: '10s', // Min uptime before considering app as "started"
      
      // Cron restart (optional - restart daily at 3 AM)
      cron_restart: '0 3 * * *',
      
      // Node.js specific (Bun ignores this)
      node_args: '--max-old-space-size=512',
      
      // Graceful shutdown
      shutdown_with_message: true
    },
    
    // Fallback configuration using Node.js (if Bun doesn't work)
    {
      name: 'cogworks-bot-node',
      script: './dist/src/index.js',
      interpreter: 'node',
      autorestart: false,  // Don't auto-start this one
      
      env: {
        NODE_ENV: 'production',
        RELEASE: 'prod'
      },
      
      error_file: './logs/error-node.log',
      out_file: './logs/out-node.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      max_memory_restart: '1000M',
      max_restarts: 10,
      restart_delay: 4000,
      instances: 1,
      exec_mode: 'fork',
      cron_restart: '0 3 * * *',
      node_args: '--max-old-space-size=512'
    }
  ],

  deploy: {
    production: {
      user: 'node',
      host: 'localhost',
      ref: 'origin/main',
      repo: 'git@github.com:NindroidA/cogworks-bot.git',
      path: '/var/www/cogworks-bot',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};
