const mongoose = require('mongoose');
const { runRecurrentSolpedAutomation } = require('../controllers/v1/finanzas/controller');

const DEFAULT_INTERVAL_MINUTES = 60;

const getIntervalMs = () => {
  const minutes = Number(process.env.RECURRENT_SOLPED_CRON_MINUTES || DEFAULT_INTERVAL_MINUTES);
  if (!Number.isFinite(minutes) || minutes < 1) return DEFAULT_INTERVAL_MINUTES * 60 * 1000;
  return Math.floor(minutes * 60 * 1000);
};

const startRecurrentSolpedCron = () => {
  let isRunning = false;

  const run = async () => {
    if (isRunning) return;
    if (mongoose.connection.readyState !== 1) return;

    try {
      isRunning = true;
      await runRecurrentSolpedAutomation();
    } catch (error) {
      console.error('[recurrent-solped-cron] Error:', error.message);
    } finally {
      isRunning = false;
    }
  };

  // Primera corrida al iniciar el backend.
  void run();

  const intervalMs = getIntervalMs();
  setInterval(() => {
    void run();
  }, intervalMs);

  console.log(`[recurrent-solped-cron] Scheduler activo cada ${Math.round(intervalMs / 60000)} min`);
};

module.exports = { startRecurrentSolpedCron };
