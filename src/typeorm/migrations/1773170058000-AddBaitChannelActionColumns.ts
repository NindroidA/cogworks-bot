import { type MigrationInterface, type QueryRunner, TableColumn } from 'typeorm';

export class AddBaitChannelActionColumns1773170058000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('bait_channel_configs', [
      new TableColumn({
        name: 'timeoutDurationMinutes',
        type: 'integer',
        default: 60,
        isNullable: false,
      }),
      new TableColumn({
        name: 'enableEscalation',
        type: 'boolean',
        default: false,
        isNullable: false,
      }),
      new TableColumn({
        name: 'escalationLogThreshold',
        type: 'integer',
        default: 30,
        isNullable: false,
      }),
      new TableColumn({
        name: 'escalationTimeoutThreshold',
        type: 'integer',
        default: 50,
        isNullable: false,
      }),
      new TableColumn({
        name: 'escalationKickThreshold',
        type: 'integer',
        default: 75,
        isNullable: false,
      }),
      new TableColumn({
        name: 'escalationBanThreshold',
        type: 'integer',
        default: 90,
        isNullable: false,
      }),
      new TableColumn({
        name: 'dmBeforeAction',
        type: 'boolean',
        default: false,
        isNullable: false,
      }),
      new TableColumn({
        name: 'appealInfo',
        type: 'varchar',
        length: '500',
        isNullable: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('bait_channel_configs', [
      'timeoutDurationMinutes',
      'enableEscalation',
      'escalationLogThreshold',
      'escalationTimeoutThreshold',
      'escalationKickThreshold',
      'escalationBanThreshold',
      'dmBeforeAction',
      'appealInfo',
    ]);
  }
}
