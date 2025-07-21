/* eslint-disable @typescript-eslint/no-explicit-any */
import cors from 'cors';
import { Client } from 'discord.js';
import express, { Application, Request, Response } from 'express';
import { Server } from 'http';
import { logger } from './utils';

const REACT = 'http://localhost:5173';
const LOCAL = 'http://localhost:3000';
const DOMAIN = 'https://nindroidsystems.com';
const SUBDOMAINS = /^https?:\/\/.*\.nindroidsystems\.com$/;

interface BotStatus {
    online: boolean
    uptime: number
    ping: number
    guilds: number
    users: number
    lastRestart: string
    timestamp: string
}

interface BotStats {
    guilds: number
    users: number
    channels: number
    uptime: number
    memoryUsage: NodeJS.MemoryUsage
    ping: number
    version: string
}

interface BotInfo {
    username: string
    discriminator: string
    id: string
    avatar: string
    status: string
}

interface CommandInfo {
    name: string
    description: string
    options: any[]
}

export class BotAPI {
    private app: Application;
    private server: Server | null = null;
    private startTime: number;

    constructor(private bot: Client) {
        this.app = express();
        this.startTime = Date.now();
        this.setupMiddleware();
        this.setupRoutes();
    }

    private setupMiddleware(): void {
        // enable cors for my domain
        this.app.use(cors({
            origin: [REACT, LOCAL, DOMAIN, SUBDOMAINS],
            credentials: true
        }));

        this.app.use(express.json());
    }

    private setupRoutes(): void {
        // health check endpoint
        this.app.get('/health', (req: Request, res: Response) => {
            try {
                const uptime = Date.now() - this.startTime;
                const status: BotStatus = {
                    online: this.bot.isReady(),
                    uptime: Math.floor(uptime / 1000),
                    ping: this.bot.ws.ping,
                    guilds: this.bot.guilds.cache.size,
                    users: this.bot.users.cache.size,
                    lastRestart: new Date(this.startTime).toISOString(),
                    timestamp: new Date().toISOString()
                };

                res.json(status);
            } catch (error) {
                logger('Health check error:' + error, 'ERROR');
                res.status(500).json({
                    online: false,
                    error: 'Health check failed'
                });
            }
        });

        // bot stats endpoint
        this.app.get('/stats', (req: Request, res: Response) => {
            try {
                if (!this.bot.isReady()) {
                    return res.status(503).json({ error: 'Bot not ready' });
                }

                const stats: BotStats = {
                    guilds: this.bot.guilds.cache.size,
                    users: this.bot.users.cache.size,
                    channels: this.bot.channels.cache.size,
                    uptime: Math.floor((Date.now() - this.startTime) / 1000),
                    memoryUsage: process.memoryUsage(),
                    ping: this.bot.ws.ping,
                    version: process.env.npm_package_version || '1.0.0'
                };

                res.json(stats);
            } catch (error) {
                logger('Stats error:' + error, 'ERROR');
                res.status(500).json({ error: 'Failed to get stats' });
            }
        });

        // bot info endpoint
        this.app.get('/info', (req: Request, res: Response) => {
            try {
                if (!this.bot.isReady() || !this.bot.user) {
                    return res.status(503).json({ error: 'Bot not ready' });
                }

                const info: BotInfo = {
                    username: this.bot.user.username,
                    discriminator: this.bot.user.discriminator,
                    id: this.bot.user.id,
                    avatar: this.bot.user.displayAvatarURL(),
                    status: 'online'
                };

                res.json(info);
            } catch (error) {
                logger('Info error:' + error, 'ERROR');
                res.status(500).json({ error: 'Failed to get bot info' });
            }
        });

        // commands list endpoint
        this.app.get('/commands', (req: Request, res: Response) => {
            try {
                if (!this.bot.isReady()) {
                    return res.status(503).json({ error: 'Bot not ready' });
                }

                const commands: CommandInfo[] = this.bot.application?.commands?.cache?.map(cmd => ({
                    name: cmd.name,
                    description: cmd.description,
                    options: cmd.options || []
                })) || [];

                res.json({ commands });
            } catch (error) {
                logger('Commands error:' + error, 'ERROR');
                res.status(500).json({ error: 'Failed to get commands' });
            }
        });

        // ping endpoint
        this.app.get('/ping', (req: Request, res: Response) => {
            res.json({ 
                message: 'pong',
                timestamp: new Date().toISOString(),
                uptime: Math.floor((Date.now() - this.startTime) / 1000)
            });
        });

        // bot uptime endpoint
        this.app.get('/uptime', (req: Request, res: Response) => {
            const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
            const days = Math.floor(uptimeSeconds / 86400);
            const hours = Math.floor((uptimeSeconds % 86400) / 3600);
            const minutes = Math.floor((uptimeSeconds % 3600) / 60);
            const seconds = uptimeSeconds % 60;

            res.json({
                uptime: uptimeSeconds,
                formatted: `${days}d ${hours}h ${minutes}m ${seconds}s`,
                startTime: new Date(this.startTime).toISOString()
            });
        });

        // 404 handler
        this.app.use((req: Request, res: Response) => {
            res.status(404).json({ 
                error: 'Endpoint not found',
                path: req.path,
                method: req.method,
                availableEndpoints: ['/health', '/stats', '/info', '/commands', '/ping', '/uptime']
            });
        });

        // error handler
        this.app.use((error: Error, req: Request, res: Response) => {
            logger('API Error:' + error, 'ERROR');
            res.status(500).json({ error: 'Internal server error' });
        });
    }

    public async start(port: number = 3001): Promise<Server> {
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(port, () => {
                    logger(`🚀 Bot API server running on port ${port}`);
                    logger(`📊 Health check: http://localhost:${port}/health`);
                    resolve(this.server!);
                });

                this.server.on('error', (error: Error) => {
                    logger('Failed to start API server:' + error, 'ERROR');
                    reject(error);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    public async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    logger('🛑 Bot API server stopped', 'WARN');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    // getter method to get current status
    public getStatus(): BotStatus {
        const uptime = Date.now() - this.startTime;
        return {
            online: this.bot.isReady(),
            uptime: Math.floor(uptime / 1000),
            ping: this.bot.ws.ping,
            guilds: this.bot.guilds.cache.size,
            users: this.bot.users.cache.size,
            lastRestart: new Date(this.startTime).toISOString(),
            timestamp: new Date().toISOString()  
        };
    }
}