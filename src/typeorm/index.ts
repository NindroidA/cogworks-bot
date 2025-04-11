import { DataSource } from 'typeorm';
import dotenv from 'dotenv';
import { TicketConfig } from './entities/TicketConfig';
import { Ticket } from './entities/Ticket';
import { ArchivedTicketConfig } from './entities/ArchivedTicketConfig';
import { ArchivedTicket } from './entities/ArchivedTicket';
import { ServerConfig } from './entities/ServerConfig';
import { SavedRole } from './entities/SavedRole';
dotenv.config();

export const AppDataSource = new DataSource({
    type: 'mysql',
    host: process.env.MYSQL_DB_HOST,
    port: parseInt(process.env.MYSQL_DB_PORT!),
    username: process.env.MYSQL_DB_USERNAME,
    password: process.env.MYSQL_DB_PASSWORD,
    database: process.env.MYSQL_DB_DATABASE,
    synchronize: true,
    entities: [TicketConfig, Ticket, ArchivedTicketConfig, ArchivedTicket, ServerConfig, SavedRole],
});