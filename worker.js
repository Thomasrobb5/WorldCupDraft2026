/**
 * World Cup Draft 2026 - Cloudflare Worker Backend & Public Dashboard
 * 
 * API Endpoints:
 * - OPTIONS : CORS Preflight
 * - GET /api/draft : Returns current draft state (JSON)
 * - POST /api/draft : Saves draft state (JSON)
 * - GET / : Serves a premium, live-polling read-only summary page
 */

// Global in-memory state fallback (resets when worker restarts)
let memoryState = {
  players: [],
  draftResults: [],
  gameState: 'SELECTING_PLAYER',
  selectedPlayer: null,
  selectedTeam: null,
  isMuted: false,
  spinDuration: 6.0,
  spinSpeedFactor: 1.0
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS Headers for local SPA file:/// compatibility
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    // Handle Preflight OPTIONS
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. POST /api/draft - Save draft state
    if (path === '/api/draft' && method === 'POST') {
      try {
        const body = await request.json();
        
        // Basic validation
        if (body && Array.isArray(body.players) && Array.isArray(body.draftResults)) {
          const stateToSave = {
            players: body.players,
            draftResults: body.draftResults,
            gameState: body.gameState || 'SELECTING_PLAYER',
            selectedPlayer: body.selectedPlayer || null,
            selectedTeam: body.selectedTeam || null,
            isMuted: body.isMuted || false,
            spinDuration: body.spinDuration !== undefined ? body.spinDuration : 6.0,
            spinSpeedFactor: body.spinSpeedFactor !== undefined ? body.spinSpeedFactor : 1.0
          };

          // Use KV Namespace if bound, otherwise fallback to in-memory
          if (env.DRAFT_KV) {
            await env.DRAFT_KV.put('draft_state', JSON.stringify(stateToSave));
          } else {
            memoryState = stateToSave;
          }

          return new Response(JSON.stringify({ success: true, storage: env.DRAFT_KV ? 'KV' : 'Memory' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
            status: 200
          });
        }

        return new Response(JSON.stringify({ error: 'Invalid schema' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          status: 400
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          status: 500
        });
      }
    }

    // 2. GET /api/draft - Get draft state
    if (path === '/api/draft' && method === 'GET') {
      let state = memoryState;
      if (env.DRAFT_KV) {
        const value = await env.DRAFT_KV.get('draft_state');
        if (value) {
          try {
            state = JSON.parse(value);
          } catch (e) {
            // Keep default memoryState if parsing fails
          }
        }
      }
      return new Response(JSON.stringify(state), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 3. GET / or GET /summary - Serve Public Live-Polling Dashboard
    if ((path === '/' || path === '/summary') && method === 'GET') {
      return new Response(getSummaryHTML(), {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // Fallback 404
    return new Response('Not Found', { status: 404 });
  }
};

/**
 * Serves a premium, self-contained summary page with gold/emerald design.
 * Automatically polls the API every 4 seconds to display draft outcomes in real-time.
 */
function getSummaryHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>2026 World Cup Draft Summary</title>
  <!-- Montserrat Font -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&family=Rajdhani:wght@600;700&display=swap" rel="stylesheet">
  <!-- FontAwesome Iconography -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    :root {
      --color-bg-start: #021c0e;
      --color-bg-end: #0d3d22;
      --color-card-bg: rgba(17, 22, 19, 0.88);
      --color-gold: #d4af37;
      --color-gold-light: #f3e5ab;
      --color-gold-glow: rgba(212, 175, 55, 0.25);
      --glass-blur: blur(12px);
      --border-gold: 1.5px solid rgba(212, 175, 55, 0.2);
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Montserrat', sans-serif;
      background: radial-gradient(circle at center, var(--color-bg-end) 0%, var(--color-bg-start) 100%);
      color: #ffffff;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding-bottom: 40px;
    }
    
    header {
      background: var(--color-card-bg);
      backdrop-filter: var(--glass-blur);
      border-bottom: 1.5px solid rgba(212, 175, 55, 0.25);
      padding: 20px 24px;
      text-align: center;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    
    .header-logo {
      color: var(--color-gold);
      font-size: 32px;
      margin-bottom: 4px;
      filter: drop-shadow(0 0 8px rgba(212, 175, 55, 0.5));
    }
    
    .header-title {
      font-family: 'Rajdhani', sans-serif;
      font-size: 28px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 2px;
      background: linear-gradient(135deg, var(--color-gold-light) 0%, var(--color-gold) 60%, #ffffff 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    
    .header-subtitle {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 3px;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 600;
    }
    
    .progress-banner {
      margin-top: 10px;
      background: rgba(212, 175, 55, 0.1);
      border: 1px solid rgba(212, 175, 55, 0.3);
      padding: 4px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 700;
      color: var(--color-gold-light);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .completed-badge {
      background: #059669 !important;
      border-color: #34d399 !important;
      color: #ffffff !important;
      animation: pulseComplete 1.5s infinite alternate;
    }
    
    @keyframes pulseComplete {
      0% { box-shadow: 0 0 5px rgba(52, 211, 153, 0.2); }
      100% { box-shadow: 0 0 15px rgba(52, 211, 153, 0.6); }
    }
    
    main {
      max-width: 1200px;
      width: 100%;
      margin: 30px auto 0;
      padding: 0 20px;
      flex-grow: 1;
    }
    
    .players-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px;
    }
    
    .player-card {
      background: var(--color-card-bg);
      border: var(--border-gold);
      border-radius: 16px;
      padding: 16px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      display: flex;
      flex-direction: column;
      gap: 14px;
      backdrop-filter: var(--glass-blur);
      transition: transform 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
    }
    
    .player-card:hover {
      transform: translateY(-2px);
      border-color: rgba(212, 175, 55, 0.45);
      box-shadow: 0 10px 30px var(--color-gold-glow);
    }
    
    .player-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 10px;
    }
    
    .player-name {
      font-size: 18px;
      font-weight: 800;
      color: #ffffff;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .player-quota {
      font-family: 'Rajdhani', sans-serif;
      font-size: 15px;
      font-weight: 700;
      color: var(--color-gold);
    }
    
    .teams-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 50px;
    }
    
    .team-item {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.05);
      padding: 8px 10px;
      border-radius: 10px;
      transition: background 0.2s ease;
    }
    
    .team-item:hover {
      background: rgba(255, 255, 255, 0.06);
    }
    
    .team-flag {
      width: 32px;
      height: 20px;
      object-fit: cover;
      border-radius: 3px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    }
    
    .team-name {
      font-size: 13px;
      font-weight: 700;
      color: #ffffff;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .no-teams {
      color: rgba(255,255,255,0.25);
      font-style: italic;
      font-size: 12px;
      text-align: center;
      padding: 16px 0;
    }
    
    .loading-container {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 80px 0;
      color: var(--color-gold);
      font-size: 18px;
      font-weight: 600;
      gap: 12px;
    }
    
    .spinner {
      animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>

  <header>
    <div class="header-logo"><i class="fa-solid fa-trophy"></i></div>
    <h1 class="header-title">World Cup 2026</h1>
    <p class="header-subtitle">Live Draft Summary</p>
    <div id="progress-container" class="progress-banner">
      <span>Draft Progress: Checking...</span>
    </div>
  </header>

  <main>
    <div id="dashboard-content">
      <div class="loading-container">
        <i class="fa-solid fa-circle-notch spinner"></i> Loading Draft Summary...
      </div>
    </div>
  </main>

  <script>
    // Live Polling Logic
    const apiEndpoint = '/api/draft';
    let lastHash = '';

    async function fetchSummary() {
      try {
        const res = await fetch(apiEndpoint);
        if (!res.ok) throw new Error('API offline');
        const state = await res.json();
        
        // Simple hash check to avoid redundant DOM re-renders
        const currentHash = JSON.stringify(state.draftResults);
        if (currentHash === lastHash) return;
        lastHash = currentHash;
        
        renderDashboard(state);
      } catch (err) {
        console.error('Error fetching live summary:', err);
      }
    }

    function renderDashboard(state) {
      const container = document.getElementById('dashboard-content');
      const progressContainer = document.getElementById('progress-container');
      
      const draftedCount = state.draftResults.length;
      const totalMax = state.players.reduce((sum, p) => sum + p.maxDrafts, 0);
      const isComplete = draftedCount > 0 && draftedCount === totalMax;
      
      // Update progress banner
      progressContainer.innerHTML = `
        <i class="fa-solid \${isComplete ? 'fa-circle-check' : 'fa-circle-notch \${draftedCount > 0 ? 'spinner' : ''}'}"></i>
        <span>Draft Progress: \${draftedCount} / \${totalMax} \${isComplete ? '(Complete!)' : ''}</span>
      `;
      if (isComplete) {
        progressContainer.classList.add('completed-badge');
      } else {
        progressContainer.classList.remove('completed-badge');
      }

      if (!state.players || state.players.length === 0) {
        container.innerHTML = \`<div class="no-teams">No players registered in the draft.</div>\`;
        return;
      }

      let html = '<div class="players-grid">';
      
      state.players.forEach(player => {
        const playerResults = state.draftResults.filter(r => r.player === player.name);
        const quotaMet = playerResults.length >= player.maxDrafts;
        
        html += \`
          <div class="player-card">
            <div class="player-header">
              <h2 class="player-name">\${player.name}</h2>
              <span class="player-quota">\${playerResults.length} / \${player.maxDrafts}</span>
            </div>
            <div class="teams-list">
        \`;
        
        if (playerResults.length === 0) {
          html += \`<div class="no-teams">No teams drafted yet</div>\`;
        } else {
          playerResults.forEach(res => {
            html += \`
              <div class="team-item">
                <img src="https://flagcdn.com/w40/\${res.team.code}.png" class="team-flag" alt="\${res.team.name}" />
                <span class="team-name">\${res.team.name}</span>
              </div>
            \`;
          });
        }
        
        html += \`
            </div>
          </div>
        \`;
      });
      
      html += '</div>';
      container.innerHTML = html;
    }

    // Start Live Polling
    fetchSummary();
    setInterval(fetchSummary, 4000);
  </script>
</body>
</html>`;
}
