/**
 * Test script for database migration
 * Run this BEFORE production migration to verify everything works
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';

// Mock environment for testing
const TEST_MODE = process.env.TEST_MODE === 'true';

async function testMigrationPrerequisites() {
  console.log('\n=== Database Migration Pre-Check ===\n');

  // Check 1: Database connection
  console.log('1. Testing database connection...');
  try {
    const dataSource = new DataSource({
      type: 'mysql',
      host: process.env.MYSQL_DB_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_DB_PORT || '3306'),
      username: process.env.MYSQL_DB_USERNAME || 'root',
      password: process.env.MYSQL_DB_PASSWORD,
      database: process.env.MYSQL_DB_DATABASE || 'cogworks',
      entities: [],
      synchronize: false,
    });

    await dataSource.initialize();
    console.log('✅ Database connection successful');
    
    // Check 2: Required tables exist
    console.log('\n2. Checking required tables exist...');
    const requiredTables = [
      'applications',
      'tickets', 
      'archived_applications',
      'archived_tickets',
      'application_configs',
      'ticket_configs'
    ];

    const existingTables = await dataSource.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()'
    );
    const tableNames = existingTables.map((t: any) => t.table_name || t.TABLE_NAME);

    for (const table of requiredTables) {
      if (tableNames.includes(table)) {
        console.log(`✅ Table '${table}' exists`);
      } else {
        console.log(`❌ Table '${table}' MISSING - create it first!`);
      }
    }

    // Check 3: Check if migration already run
    console.log('\n3. Checking migration status...');
    const applicationsColumns = await dataSource.query(
      'SHOW COLUMNS FROM applications'
    );
    const hasGuildId = applicationsColumns.some(
      (col: any) => (col.Field || col.FIELD) === 'guildId'
    );

    if (hasGuildId) {
      console.log('⚠️  Migration already completed (guildId column exists)');
    } else {
      console.log('✅ Migration not yet run (guildId column missing)');
    }

    // Check 4: Count existing records
    console.log('\n4. Counting existing records...');
    const [appCount] = await dataSource.query('SELECT COUNT(*) as count FROM applications');
    const [ticketCount] = await dataSource.query('SELECT COUNT(*) as count FROM tickets');
    const [archivedAppCount] = await dataSource.query('SELECT COUNT(*) as count FROM archived_applications');
    const [archivedTicketCount] = await dataSource.query('SELECT COUNT(*) as count FROM archived_tickets');

    console.log(`   Applications: ${appCount.count || appCount.COUNT}`);
    console.log(`   Tickets: ${ticketCount.count || ticketCount.COUNT}`);
    console.log(`   Archived Applications: ${archivedAppCount.count || archivedAppCount.COUNT}`);
    console.log(`   Archived Tickets: ${archivedTicketCount.count || archivedTicketCount.COUNT}`);

    // Check 5: Test database permissions
    console.log('\n5. Testing database permissions...');
    try {
      await dataSource.query('SHOW GRANTS FOR CURRENT_USER()');
      console.log('✅ Can query grants');
    } catch (error) {
      console.log('⚠️  Cannot query grants (may be limited permissions)');
    }

    // Check 6: Estimate migration time
    console.log('\n6. Estimating migration time...');
    const totalRecords = 
      (appCount.count || appCount.COUNT) + 
      (ticketCount.count || ticketCount.COUNT) +
      (archivedAppCount.count || archivedAppCount.COUNT) +
      (archivedTicketCount.count || archivedTicketCount.COUNT);
    
    const estimatedSeconds = Math.ceil(totalRecords / 1000) + 5; // ~1000 records/sec + overhead
    console.log(`   Total records: ${totalRecords}`);
    console.log(`   Estimated time: ~${estimatedSeconds} seconds`);

    if (totalRecords > 10000) {
      console.log('   ⚠️  Large dataset - consider running during low-traffic time');
    }

    await dataSource.destroy();

    // Final summary
    console.log('\n=== Summary ===\n');
    if (hasGuildId) {
      console.log('❌ Migration already completed - no action needed');
      console.log('   If you need to re-migrate, restore from backup first');
      return false;
    } else {
      console.log('✅ Ready for migration!');
      console.log('\nNext steps:');
      console.log('1. Backup database: mysqldump -u user -p cogworks > backup.sql');
      console.log('2. Stop bot: pm2 stop cogworks-bot');
      console.log('3. Run migration: npx ts-node src/utils/databaseMigration.ts');
      console.log('4. Verify with queries in docs/DATABASE_MIGRATION.md');
      console.log('5. Restart bot: pm2 restart cogworks-bot');
      return true;
    }

  } catch (error) {
    console.error('❌ Error during pre-check:', error);
    console.log('\nFix the error above before attempting migration!');
    return false;
  }
}

// Run the test
testMigrationPrerequisites()
  .then(canMigrate => {
    process.exit(canMigrate ? 0 : 1);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
