import dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { Application } from './entities/application/Application';
import { ApplicationConfig } from './entities/application/ApplicationConfig';
import { ArchivedApplication } from './entities/application/ArchivedApplication';
import { ArchivedApplicationConfig } from './entities/application/ArchivedApplicationConfig';
import { Position } from './entities/application/Position';
import { BotConfig } from './entities/BotConfig';
import { SavedRole } from './entities/SavedRole';
import { ServerConfig } from './entities/ServerConfig';
import { ArchivedTicket } from './entities/ticket/ArchivedTicket';
import { ArchivedTicketConfig } from './entities/ticket/ArchivedTicketConfig';
import { Ticket } from './entities/ticket/Ticket';
import { TicketConfig } from './entities/ticket/TicketConfig';
dotenv.config();

export const AppDataSource = new DataSource({
    type: 'mysql',
    host: process.env.MYSQL_DB_HOST,
    port: parseInt(process.env.MYSQL_DB_PORT!),
    username: process.env.MYSQL_DB_USERNAME,
    password: process.env.MYSQL_DB_PASSWORD,
    database: process.env.MYSQL_DB_DATABASE,
    synchronize: true,
    entities: [TicketConfig, Ticket, ArchivedTicketConfig, ArchivedTicket, ServerConfig, SavedRole, BotConfig, Application, ApplicationConfig, ArchivedApplication, ArchivedApplicationConfig, Position],
});