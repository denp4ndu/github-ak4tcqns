import pg from 'pg';

async function run() {
  const client = new pg.Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/esp32_iot_monitor'
  });
  
  await client.connect();
  console.log('Successfully connected via pg client!');
  
  try {
    await client.query('BEGIN');
    console.log('BEGIN transaction executed.');
    
    // Attempt invalid insert
    await client.query(`
      INSERT INTO "batch_items" ("id", "batchId", "projectId", "deviceId", "virtualPin", "value", "updatedAt")
      VALUES ('test-item-a', 'some-non-existent-batch', 'some-project', 'some-device', 'V1', '10', NOW())
    `);
  } catch (err: any) {
    console.log('Caught expected error!');
    console.log('Code:', err.code);
    console.log('Constraint:', err.constraint);
    console.log('Table:', err.table);
    console.log('Message:', err.message);
  } finally {
    try {
      await client.query('ROLLBACK');
      console.log('ROLLBACK executed successfully.');
    } catch (rollbackErr: any) {
      console.error('Rollback error:', rollbackErr.message);
    }
    await client.end();
  }
}

run().catch(console.error);
