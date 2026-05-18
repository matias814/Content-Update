'use strict';

require('dotenv').config();
const cron = require('node-cron');
const sync = require('./sync');

const SCHEDULE = process.env.CRON_SCHEDULE || '0 6 * * *';
const TIMEZONE = process.env.CRON_TIMEZONE || 'UTC';

// Run once immediately so a fresh Railway deploy is always up to date
sync().catch(err => {
  console.error(`[startup] Sync failed: ${err.message}`);
  if (err.response) {
    console.error(`  HTTP ${err.response.status}:`, JSON.stringify(err.response.data));
  }
});

cron.schedule(
  SCHEDULE,
  () => {
    sync().catch(err => {
      console.error(`[cron] Sync failed: ${err.message}`);
      if (err.response) {
        console.error(`  HTTP ${err.response.status}:`, JSON.stringify(err.response.data));
      }
    });
  },
  { timezone: TIMEZONE }
);

console.log(`Scheduler active — cron "${SCHEDULE}" (${TIMEZONE})`);
