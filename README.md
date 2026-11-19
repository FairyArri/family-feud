# Family Feud (multiplayer)

Host runs the game, two team leaders buzz from their own phones or laptops, everyone else watches the live board.

## Run locally
    npm install
    npm start        # http://localhost:3000

## Deploy (Render, free tier)
1. Push this folder to a GitHub repo.
2. Render > New > Web Service > pick the repo.
3. Build command: `npm install`   Start command: `npm start`
4. Open the URL Render gives you. Share it with players.
Note: free instances sleep when idle. Open the URL a few minutes before the game to wake it. Rooms live in memory, so a restart ends the game.

## Edit questions
Change `questions.js` (4 answers per round, [text, points]).

## Flow
Host opens buzzer > first leader to buzz is locked in > host clicks the answer if correct > play or pass > one strike ends the turn > other team steals once > pot goes to the winner > next round.
Wrong face-off answer: other leader answers, no strike. Both wrong: host reopens the buzzer.
Host has an Undo button for misclicks.

## Test
    node test.js
