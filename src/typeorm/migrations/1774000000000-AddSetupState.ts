import { type MigrationInterface, type QueryRunner, Table } from 'typeorm';

export class AddSetupState1774000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'setup_states',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'guildId',
            type: 'varchar',
            length: '255',
            isUnique: true,
          },
          {
            name: 'selectedSystems',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'systemStates',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'partialData',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'updatedAt',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
            onUpdate: 'CURRENT_TIMESTAMP(6)',
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('setup_states', true);
  }
}
