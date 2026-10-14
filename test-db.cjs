const { Client } = require('pg');

async function testConnection(password) {
  const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'postgres',
    password: password,
    port: 5432,
  });

  try {
    await client.connect();
    console.log(`Successfully connected with password: ${password}`);
    await client.end();
  } catch (err) {
    console.error(`Connection failed for password: ${password}`, err.message);
  }
}

async function run() {
  await testConnection('Password');
  await testConnection('postgres');
  await testConnection('admin');
  await testConnection('root');
}

run();
