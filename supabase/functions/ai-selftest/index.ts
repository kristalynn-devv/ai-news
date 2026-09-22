import { withSupabase } from 'npm:@supabase/server@1.7.1';
import { readAiRuntimeConfig } from '../_shared/ai-config.ts';
import { ProbeError, runProbe } from '../_shared/ai-probe.ts';

// auth: 'secret' keeps this off the publishable key the static site ships, so no reader can spend the AI credit.
export default {
  fetch: withSupabase({ auth: 'secret' }, async (req: Request) => {
    // GET is refused so an uptime monitor aimed at this URL cannot bill a model call on every poll.
    if (req.method !== 'POST') {
      return Response.json(
        { ok: false, code: 'method_not_allowed', message: 'the probe only answers POST' },
        { status: 405, headers: { allow: 'POST' } },
      );
    }

    let config;
    try {
      config = readAiRuntimeConfig((name) => Deno.env.get(name));
    } catch {
      return Response.json(
        { ok: false, code: 'not_configured', message: 'AI runtime secrets are missing or invalid' },
        { status: 503 },
      );
    }

    try {
      return Response.json({ ok: true, ...(await runProbe(config, fetch)) });
    } catch (error) {
      if (error instanceof ProbeError) {
        return Response.json({ ok: false, code: error.code, message: error.message }, { status: error.status });
      }
      return Response.json({ ok: false, code: 'probe_failed', message: 'the probe failed unexpectedly' }, { status: 500 });
    }
  }),
};
