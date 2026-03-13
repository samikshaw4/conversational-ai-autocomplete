# 🔍 Real-Time Autocomplete Suggestion System for Conversational AI

> A production implementation of a **Search Autocomplete / Type-ahead Suggestion System** built inside a conversational AI bot flow — the same concept featured in top system design interviews (Alex Xu's *System Design Interview*, Chapter: "Design a Search Autocomplete System").

---

## 🧠 What This Solves

When users interact with a chatbot, they often struggle to phrase their queries correctly. This system:

- **Predicts user intent in real time** as they type
- **Surfaces the top N matching intents** as quick-reply suggestions
- **Falls back gracefully** when no strong match is found
- **Reduces user drop-off** caused by bot misunderstanding free-text input

---

## 🏗️ System Design Overview

This maps directly to classic autocomplete architecture:

```
User types input
       ↓
[Prediction API Call]        ← like a Trie/frequency-ranked prefix lookup
       ↓
[Parse & Rank Intents]       ← filter, normalize, deduplicate
       ↓
[Quick Reply UI Component]   ← top-k suggestions shown to user
       ↓
User selects → Bot processes confirmed intent
```

### Design Decisions Made (and Why)

| Decision | Rationale |
|---|---|
| API-based prediction over static list | Supports dynamic intent growth without flow changes |
| Top-k suggestions capped | Avoids overwhelming users; UX best practice |
| "Not Found" fallback option always appended | Prevents dead-ends; gives users an escape hatch |
| Intent name normalization (strip `_`, replace `-`) | Raw ML model output is not user-readable |
| Conditional routing post-selection | Resets query context cleanly before passing to main flow |

---

## ⚙️ Implementation Flow

### Step 1 — Capture User Input
The system activates on a prompt node that expects free-text input from the user.

### Step 2 — Call the Prediction API
```bash
curl --location 'https://<platform-host>/api/ai/prediction?bot=<BOT_ID>' \
  --header 'X-Api-Key: <API_KEY>' \
  --header 'Content-Type: application/json' \
  --data '{
    "language": "en",
    "text": "<user_message>"
  }'
```

The API returns a ranked list of matched intents under `similar_intents` or `intents`.

### Step 3 — Parse & Normalize Suggestions (JavaScript)
```javascript
return new Promise(resolve => {
  let getSuggestions = data.variables.suggestions;

  // Handle both response shapes from the prediction model
  getSuggestions = getSuggestions.data.similar_intents
    ? getSuggestions.data.similar_intents
    : getSuggestions.data.intents;

  // Null guard — no match found
  if (getSuggestions == null) {
    resolve({ null: 'null' });
    return;
  }

  let suggestions = [];

  for (let i = 0; i < getSuggestions.length; i++) {
    // Extract name, handling varied response shapes
    let name = getSuggestions[i].name
      ? getSuggestions[i].name
      : getSuggestions[i].data.intents;

    // Normalize: take first token if underscore-separated (e.g. "order_status" → "order")
    if (name && name.includes('_')) {
      name = name.split('_')[0];
    }

    suggestions.push({
      title: name.replace(/-/g, ' '),  // "track-order" → "track order"
      text: name.replace(/-/g, ' ')
    });
  }

  // Always append fallback
  suggestions.push({ title: 'Not Found', text: 'Not Found' });

  resolve({
    title: "Hmm, I'm a little confused. Are these close to what you meant?",
    options: suggestions
  });
});
```

### Step 4 — Display & Route
- **If suggestions found** → Render as quick-reply buttons
- **If null** → Show static fallback message: *"Sorry, I was unable to understand your query"*
- **On user selection** → Reset query variable → Trigger main conversation flow

---

## 🔗 Connection to System Design Concepts

| System Design Concept | This Implementation |
|---|---|
| **Trie / Prefix Index** | Handled server-side by the ML prediction model |
| **Top-K results** | Extracted from `similar_intents` ranked list |
| **Normalization** | `_` and `-` stripping in the function node |
| **Fallback / Graceful Degradation** | Null check + static error message |
| **Low Latency** | Single async API call, lightweight JS processing |
| **User confirms selection** | Selection resets context variable — avoids ambiguity |

---

## 💡 Key Learnings

- Real autocomplete systems need **two layers**: retrieval (find candidates) and **presentation** (format for the UI). This implementation handles both.
- Handling **varied API response shapes** (`similar_intents` vs `intents`) is a real-world robustness concern not covered in textbook system design.
- Always add a **"Not Found" escape hatch** — without it, users have no recovery path when suggestions don't match.
- Intent names from ML models are **not human-readable by default** — normalization is essential for good UX.

---

## 🏷️ Skills Demonstrated

`Conversational AI` · `System Design` · `JavaScript` · `REST API Integration` · `NLP / Intent Recognition` · `UX Flow Design` · `Technical Documentation`

---

## 📁 Related Concepts to Explore

- [System Design Interview – Alex Xu, Chapter: Design a Search Autocomplete System](https://www.amazon.in/System-Design-Interview-insiders-Second/dp/B08CMF2CQF)
- Trie data structures for prefix search
- Debouncing strategies for type-ahead APIs
- Top-K frequent elements (LeetCode #347)
