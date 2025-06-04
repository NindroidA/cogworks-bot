import dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { ArchivedTicket } from './entities/ArchivedTicket';
import { ArchivedTicketConfig } from './entities/ArchivedTicketConfig';
import { BotConfig } from './entities/BotConfig';
import { SavedRole } from './entities/SavedRole';
import { ServerConfig } from './entities/ServerConfig';
import { Ticket } from './entities/Ticket';
import { TicketConfig } from './entities/TicketConfig';
dotenv.config();

export const AppDataSource = new DataSource({
    type: 'mysql',
    host: process.env.MYSQL_DB_HOST,
    port: parseInt(process.env.MYSQL_DB_PORT!),
    username: process.env.MYSQL_DB_USERNAME,
    password: process.env.MYSQL_DB_PASSWORD,
    database: process.env.MYSQL_DB_DATABASE,
    synchronize: true,
    entities: [TicketConfig, Ticket, ArchivedTicketConfig, ArchivedTicket, ServerConfig, SavedRole, BotConfig],
    //entities: [TicketConfig, Ticket, ArchivedTicketConfig, ArchivedTicket, ServerConfig, SavedRole, BotConfig, Card, CardAbility, BattleAbilityUses, BattleCardStates, GameSession, PlayerDeck, PlayerStats],
});