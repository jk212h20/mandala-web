# Mandala Game - Two Player Online

A mobile-friendly web version of the Mandala card game for two players.

## 🎮 How to Play

1. One player creates a game and shares the 4-letter room code
2. The other player joins with that code
3. Take turns playing cards to the mandalas
4. When a mandala has all 6 colors, claim the mountain cards!
5. First to fill their river with 6 colors OR when the deck runs out, highest score wins

## 🚀 Quick Start (Local Development)

```bash
# Install dependencies
npm install

# Start the server
npm start

# Open http://localhost:3000 in your browser
```

## 📱 Features

- **Mobile-first design** - Works great on phones and tablets
- **Real-time multiplayer** - Play with friends anywhere
- **No account needed** - Just share a room code
- **Hidden information** - You can't see your opponent's hand or starting cup cards

## 🌐 Deploy to Railway (Free)

1. **Create a Railway account** at [railway.app](https://railway.app)

2. **Push this folder to GitHub** as a new repository:
   ```bash
   cd mandala-web
   git init
   git add .
   git commit -m "Initial commit"
   gh repo create mandala-game --public --source=. --push
   ```
   Or create a repo on GitHub and push manually.

3. **Deploy on Railway**:
   - Go to [railway.app/dashboard](https://railway.app/dashboard)
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your mandala-game repo
   - Railway will auto-detect Node.js and deploy

4. **Get your URL**:
   - Once deployed, click on your project
   - Go to Settings → Domains
   - Click "Generate Domain" to get a free `.up.railway.app` URL

That's it! Share the URL with friends to play.

## 🎯 Game Rules Summary

### Turn Actions (pick one):
- **Build Mountain**: Play 1 card to a mountain, draw up to 3 cards
- **Grow Field**: Play 1+ cards of the same color to your field (keep at least 1 card in hand)
- **Discard & Redraw**: Discard any number of same-colored cards, draw that many

### Rule of Color:
A color can only exist in ONE place within a mandala:
- If a color is in the mountain, it can't go to either field
- If a color is in a field, it can't go to the mountain or the other player's field

### Mandala Completion:
When all 6 colors are present in a mandala:
1. Player with more cards in their field picks first
2. Take turns claiming one color at a time from the mountain
3. First new color goes to your river (scoring track), rest go to cup
4. Cards in your cup score based on river position (1-6 points each)

### Game End:
- A player gets their 6th river color, OR
- The deck is exhausted and reshuffled

### Scoring:
- Each card in your cup scores points = its river slot position (1-6)
- Highest score wins!
- Tie-breaker: fewer cards in cup wins

## 📁 Project Structure

```
mandala-web/
├── server.js          # Node.js WebSocket server
├── game.js            # Game engine (rules & state)
├── package.json       # Dependencies
├── public/
│   ├── index.html     # Game UI
│   ├── style.css      # Mobile-first styles
│   └── client.js      # WebSocket client & rendering
└── README.md          # This file
```

## 🔧 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port (Railway sets this automatically) |

## License

MIT
