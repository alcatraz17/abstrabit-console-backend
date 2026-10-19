export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      fetch(env.SWEEP_URL, {
        headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
        signal: AbortSignal.timeout(25_000),
      }).then((response) => {
        if (!response.ok) throw new Error(`Sweep returned ${response.status}`);
      }),
    );
  },
};
