/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable unused-imports/no-unused-vars */
import axios, { AxiosInstance } from 'axios';
import { Client } from 'discord.js';
import { version } from '../../package.json';

/* Interface for bot stats data sent to API */
interface BotStatsPayload {
    guilds: number;
    users: number;
    channels: number;
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    ping: number;
    version: string;
    username: string;
    discriminator: string;
    id: string;
    avatar: string;
    online: boolean;
    timestamp: string;
}

/**
 * Connector class for communicating with API.
 * Handles registration, stats sync, and health monitoring.
 */
export class APIConnector {
    private apiClient: AxiosInstance;
    private statsInterval: NodeJS.Timeout | null = null;
    private startTime: number;
    private isConnected: boolean = false;

    /**
     * Initialize the API connector.
     * 
     * @param {string} apiUrl Base URL of the API
     * @param {string} botToken Cogworks Bot token for authentication
     */
    constructor(private apiUrl: string, private botToken: string) {
        this.startTime = Date.now();
        this.apiClient = axios.create({
            baseURL: apiUrl,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${botToken}` // for future auth if needed
            }
        });
    }

    /**
     * Register the bot with API.
     * Sends initial bot data and establishes connection.
     * 
     * @param {Client} client Discord.js client instance
     */
    async registerBot(client: Client): Promise<void> {
        try {
            // verify API is accessible
            await this.apiClient.get('/health');
            
            // send initial bot registration data
            const botData = this.createBotStatsPayload(client);
            await this.apiClient.post('/api/cogworks/register', botData);
            
            this.isConnected = true;
            console.log('✅ Bot registered with API');
        } catch (error) {
            console.error('❌ Failed to register bot with API!');
            throw error;
        }
    }

    /**
     * Start periodic stats synchronization with API.
     * Sends updated bot statistics every 5 minutes.
     * 
     * @param {Client} client - Discord.js client instance
     */
    startStatsSync(client: Client): void {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }

        this.statsInterval = setInterval(async () => {
            try {
                if (client.isReady() && this.isConnected) {
                    const stats = this.createBotStatsPayload(client);
                    await this.apiClient.put('/api/cogworks/stats', stats);
                }
            } catch (error) {
                // don't throw - just log the error and continue
                console.error('⚠️  Failed to sync stats with API:', error);
            }
        }, 300000); // 5 minutes

        console.log('🔄 Started stats synchronization (5m interval)');
    }

    /**
     * Create bot stats payload for API communication.
     * 
     * @param {Client} client Discord.js client instance
     * @returns {BotStatsPayload} Formatted bot statistics
     */
    private createBotStatsPayload(client: Client): BotStatsPayload {
        return {
            guilds: client.guilds.cache.size,
            users: client.users.cache.size,
            channels: client.channels.cache.size,
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            memoryUsage: process.memoryUsage(),
            ping: client.ws.ping,
            version,
            username: client.user?.username || 'Cogworks Bot',
            discriminator: client.user?.discriminator || '0000',
            id: client.user?.id || 'unknown',
            avatar: client.user?.displayAvatarURL() || '',
            online: client.isReady(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Send a command execution log to API.
     * Useful for tracking bot usage through the API.
     * 
     * @param {string} commandName Name of the executed command
     * @param {string} guildId Guild where command was executed
     * @param {string} userId User who executed the command
     */
    async logCommand(commandName: string, guildId: string, userId: string): Promise<void> {
        try {
            if (this.isConnected) {
                await this.apiClient.post('/api/cogworks/command-log', {
                    command: commandName,
                    guildId,
                    userId,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error('⚠️  Failed to log command to API:', error);
        }
    }

    /**
     * Get current API connection status.
     * 
     * @returns {boolean} True if connected to API
     */
    isConnectedToAPI(): boolean {
        return this.isConnected;
    }

    /**
     * Manually trigger a stats sync.
     * 
     * @param {Client} client Discord.js client instance
     */
    async syncStats(client: Client): Promise<void> {
        if (client.isReady() && this.isConnected) {
            const stats = this.createBotStatsPayload(client);
            await this.apiClient.put('/api/cogworks/stats', stats);
        }
    }

    /**
     * Test connection to API.
     * 
     * @returns {Promise<boolean>} True if API is accessible
     */
    async testConnection(): Promise<boolean> {
        try {
            await this.apiClient.get('/health');
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Disconnect from API.
     * Stops stats sync and cleans up resources.
     */
    async disconnect(): Promise<void> {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }

        if (this.isConnected) {
            try {
                await this.apiClient.post('/api/cogworks/disconnect', {
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error('Error during API disconnect:', error);
            }
        }

        this.isConnected = false;
        console.log('🔌 Disconnected from API');
    }
}