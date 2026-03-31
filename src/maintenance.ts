/**
 * Maintenance Mode
 *
 * Lightweight startup path that connects to Discord without a database.
 * All interactions receive a maintenance message. Health endpoint reports
 * maintenance status. Suitable for running on a Raspberry Pi during downtime.
 *
 * Activated by MAINTENANCE_MODE=true in env.
 */

import { createServer, type Server, type ServerResponse } from 'node:http';
import { ActivityType, Client, EmbedBuilder, GatewayIntentBits, type Interaction, MessageFlags } from 'discord.js';
import { version } from '../package.json';

const MAINTENANCE_EMBED = new EmbedBuilder()
  .setTitle('🔧 Under Maintenance')
  .setDescription('Cogworks is currently under maintenance and will be back shortly.')
  .setColor(0xf59e0b)
  .setFooter({ text: 'We appreciate your patience!' });

const startedAt = new Date();

async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isAutocomplete()) {
      await interaction.respond([]);
      return;
    }

    if (interaction.isRepliable()) {
      if (interaction.isMessageComponent()) {
        try {
          await interaction.update({
            embeds: [MAINTENANCE_EMBED],
            components: [],
          });
        } catch {
          await interaction.reply({
            embeds: [MAINTENANCE_EMBED],
            flags: [MessageFlags.Ephemeral],
          });
        }
      } else {
        await interaction.reply({
          embeds: [MAINTENANCE_EMBED],
          flags: [MessageFlags.Ephemeral],
        });
      }
    }
  } catch {
    // Interaction may have expired — silently ignore
  }
}

function startHealthServer(client: Client): Server {
  const port = Number.parseInt(process.env.HEALTH_PORT || '3003', 10);

  const server = createServer((_req, res: ServerResponse) => {
    const url = _req.url || '/';

    if (url === '/health/live') {
      sendJson(res, 200, {
        alive: true,
        message: 'Bot process is running (maintenance mode)',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
      return;
    }

    if (url === '/health/ready') {
      sendJson(res, 503, {
        ready: false,
        message: 'Bot is in maintenance mode',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (url === '/health') {
      sendJson(res, 200, {
        status: 'maintenance',
        maintenance: true,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version,
        discord: {
          connected: client.isReady(),
          ping: client.ws.ping,
        },
      });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[MAINTENANCE] Health server listening on 0.0.0.0:${port}`);
  });

  return server;
}

function startMaintenanceApi(): Server {
  const token = process.env.COGWORKS_INTERNAL_API_TOKEN;
  const port = Number.parseInt(process.env.BOT_INTERNAL_PORT || '3002', 10);

  if (!token) {
    console.log('[MAINTENANCE] No COGWORKS_INTERNAL_API_TOKEN — skipping internal API');
    // Return a dummy server that's not listening
    return createServer();
  }

  const server = createServer((req, res: ServerResponse) => {
    // Auth check
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${token}`) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    const url = (req.url || '').split('?')[0].replace(/\/$/, '');

    if (url === '/internal/maintenance') {
      sendJson(res, 200, {
        active: true,
        startedAt: startedAt.toISOString(),
        version,
      });
      return;
    }

    if (url === '/internal/health') {
      sendJson(res, 200, {
        status: 'maintenance',
        maintenance: true,
        uptime: process.uptime(),
        version,
      });
      return;
    }

    sendJson(res, 503, {
      error: 'Service unavailable',
      message: 'Bot is in maintenance mode',
    });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[MAINTENANCE] Internal API listening on 0.0.0.0:${port}`);
  });

  return server;
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

export async function startMaintenanceMode(): Promise<void> {
  const IS_DEV = (process.env.RELEASE || 'prod').toLowerCase().trim() === 'dev';
  const TOKEN = IS_DEV ? process.env.DEV_BOT_TOKEN : process.env.BOT_TOKEN;

  if (!TOKEN) {
    console.error(`[MAINTENANCE] ${IS_DEV ? 'DEV_BOT_TOKEN' : 'BOT_TOKEN'} not set — cannot start`);
    process.exit(1);
  }

  console.log('🔧 Starting in MAINTENANCE MODE (no database)');

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.on('interactionCreate', handleInteraction);

  client.once('clientReady', () => {
    console.log(`🔧 Maintenance mode active: ${client.user?.tag}`);

    client.user?.setPresence({
      activities: [
        {
          name: 'Status',
          type: ActivityType.Custom,
          state: '🔧 Under Maintenance',
        },
      ],
      status: 'idle',
    });
  });

  // Start servers
  const healthSrv = startHealthServer(client);
  const apiSrv = startMaintenanceApi();

  // Graceful shutdown
  let isShuttingDown = false;
  async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[MAINTENANCE] Received ${signal}, shutting down`);

    await new Promise<void>(resolve => healthSrv.close(() => resolve()));
    await new Promise<void>(resolve => apiSrv.close(() => resolve()));
    client.destroy();
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await client.login(TOKEN);
}
