# bunq Aether — Hackathon 7.0

## Run immediately

```bash
npm install     # already done
npm run dev     # http://localhost:3000
```

## Plugging in real APIs

### 1. bunq OAuth
In `src/services/bunqAPI.js`:
- Replace `BUNQ_ACCESS_TOKEN_PLACEHOLDER` with a real token
- Use `bunqAPI.getOAuthUrl()` + `bunqAPI.exchangeCode()` for the full OAuth flow
- All API calls are ready with correct bunq v1 endpoints

### 2. Claude AI (vision + voice)
In `src/services/aetherAI.js`:
- Replace `ANTHROPIC_API_KEY_PLACEHOLDER` with your key
- Uncomment the `fetch('https://api.anthropic.com/v1/messages', ...)` block in `callClaude()`
- Remove the `mockAIResponse()` call — real responses follow the exact same JSON schema

## Project structure

```
src/
  pages/
    Dashboard.jsx      — Main financial overview
    AetherMode.jsx     — Live camera + AI overlay
    ActionLog.jsx      — Full action history + impact
    Settings.jsx       — API keys, toggles
    Onboarding.jsx     — First-launch slides
  components/
    NavBar.jsx         — Bottom navigation
    VoiceInput.jsx     — Web Speech API + volume viz
    ActionPanel.jsx    — AI action recommendations drawer
    UndoBar.jsx        — 10-second one-tap undo
    ActionToast.jsx    — Executing indicator
  services/
    bunqAPI.js         — All bunq API calls (swap BASE_URL + token)
    aetherAI.js        — Claude multimodal analysis (swap API key)
  store/
    aetherStore.js     — Zustand global state + action dispatcher
  styles/
    globals.css        — Full dark premium theme
```

## Key demo flows

1. **Impulse detection**: Go to Aether Mode → say "I want to buy these shoes" → AI shows HIGH risk + overlay hints + action panel with card block + savings boost
2. **Receipt split**: Say "split this receipt" → AI detects receipt, calculates per-person, contact picker appears, sends bunq payment requests
3. **Savings command**: Say "move money to savings" → AI recommends transfer → executes → undo bar appears for 10 seconds
4. **Dashboard voice**: On home screen, hold mic → ask anything → AI responds with relevant actions
