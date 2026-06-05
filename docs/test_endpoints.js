const token = '7a5226b3c3b143b91ecef23f5c9e689c76bf8de6502fd520a1eaf1903a2f3cf8';
const host = 'http://localhost:7070';

async function test() {
  const sessionsRes = await fetch(`${host}/api/v1/chat/sessions`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const sessions = await sessionsRes.json();
  console.log('Sessions:', sessions);

  if (sessions && sessions.length > 0) {
    const sessionId = sessions[0].sessionId;
    console.log('Using sessionId:', sessionId);

    const endpoints = [
      `/api/v1/status`,
      `/api/v1/readiness?sessionId=${sessionId}`,
      `/api/v1/llm/providers?sessionId=${sessionId}`,
      `/api/v1/llm/config/draft?sessionId=${sessionId}`,
      `/api/v1/llm/audit-trail?sessionId=${sessionId}`,
      `/api/v1/chat/telemetry?sessionId=${sessionId}`,
      `/api/v1/pending`,
      `/api/v1/actions`,
      `/api/v1/action-history`,
      `/api/v1/traces?sessionId=${sessionId}`,
      `/api/v1/events?limit=8`,
      `/api/v1/retrieval/alerts`,
      `/api/v1/retrieval/prioritized-alerts`,
      `/api/v1/telemetry/summary?window=10m`,
      `/api/v1/runtime/excellence?window=10m`,
      `/api/v1/release/validation/latest`,
      `/api/v1/release/decision/latest`,
      `/api/v1/self-review/latest`,
      `/api/v1/self-review/history?limit=5`,
      `/api/v1/session-packages`,
      `/api/v1/session-packages/history?limit=12`,
      `/api/v1/settings`,
      `/api/v1/agents`,
      `/api/v1/computer/system-info`,
      `/api/v1/tools/status`,
      `/api/v1/plugins/status`,
      `/api/v1/llm/modalities`,
      `/api/v1/models/matrix`
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(`${host}${url}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        console.log(`Endpoint ${url} status:`, res.status);
        if (res.status !== 200) {
          const text = await res.text();
          console.log(`  Error body:`, text.substring(0, 200));
        }
      } catch (err) {
        console.log(`Endpoint ${url} FAILED fetch:`, err.message);
      }
    }
  } else {
    console.log('No sessions found.');
  }
}

test().catch(console.error);
