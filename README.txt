MIGUEL'S CASINO: PUTTING IT ON THE INTERNET
==========================================

What's in this folder
  server.js      the server: shows the casino and keeps the live leaderboard
  live.js        the live tables: shared blackjack (5 seats) and roulette
  poker.js       the live Texas Hold'em table (6 seats, no limit)
  package.json   tells the hosting service how to start the server
  public/        the casino itself (lobby, blackjack, roulette, craps and
                 the three live tables)

You need three free accounts. It takes about 20 minutes the first time.
  Upstash  keeps the leaderboard saved
  GitHub   holds these files
  Render   runs the server and gives you a web address to share


STEP 1: UPSTASH (the leaderboard's memory)
  1. Go to https://upstash.com and sign up.
  2. Create a database: choose Redis, name it miguels-casino, pick the
     region closest to you (for Vienna: Frankfurt / eu-central-1) and the
     Free plan.
  3. Open the database. In the "REST API" section, copy these two values
     into a note:
        UPSTASH_REDIS_REST_URL     (starts with https://)
        UPSTASH_REDIS_REST_TOKEN   (a long code; keep it private)


STEP 2: GITHUB (where the files live)
  1. Go to https://github.com and sign up.
  2. Click "New repository". Name it miguels-casino and click
     "Create repository".
  3. Click "uploading an existing file". Drag in everything inside this
     folder: server.js, live.js, poker.js, package.json, README.txt and the public
     folder.
     If the public folder doesn't come through, open it and drag the four
     .html files in directly instead. The server finds them either way.
  4. Click "Commit changes".
  5. Check the file list on GitHub: you should see server.js, live.js, poker.js and
     index.html, blackjack.html, roulette.html, craps.html,
     blackjack-live.html, roulette-live.html, poker-live.html (either inside public/ or on
     their own).


STEP 3: RENDER (puts it online)
  1. Go to https://render.com and sign up with your GitHub account.
  2. Click "New" > "Web Service" and choose the miguels-casino repository.
  3. Fill in:
        Language / Runtime   Node
        Build command        npm install
        Start command        node server.js
        Instance type        Free
  4. Under "Environment Variables" add the two values from step 1,
     with exactly these names:
        UPSTASH_REDIS_REST_URL
        UPSTASH_REDIS_REST_TOKEN
  5. Click "Deploy". After a minute or two Render shows your address,
     something like https://miguels-casino.onrender.com
     Send that address to your friends. That's it.


CHECK IT WORKS
  Open  https://YOUR-ADDRESS/api/health
  You should see  "ok":true,  "storage":"upstash"  and every page
  marked "found". If a page says "missing", upload that file to GitHub.
  If it says "file" instead, the two Upstash values are missing or
  misspelled in Render's Environment Variables; fix them and redeploy.


GOOD TO KNOW
  - Render's free server goes to sleep after 15 minutes with no visitors.
    The next visitor waits about a minute while it wakes up. The
    leaderboard is kept safe in Upstash the whole time.
  - Every player's money is saved in their own browser, and their
    leaderboard seat belongs to that browser. On a new phone or computer
    they start a new seat.
  - To change the casino later, upload the new files to the same GitHub
    repository. Render updates the site automatically.
  - Live tables: a hand or spin that is in progress when the server
    restarts (for example during an update) is cancelled, and the chips
    on it are lost. Update the site when nobody is mid-hand.
    Poker players are safe: when the server comes back, everyone who was
    sitting at the Hold'em table gets their whole stack (including chips
    in an unfinished pot) back in their bankroll the next time they open
    the table.


PLAY ON YOUR OWN COMPUTER INSTEAD
  Install Node.js from https://nodejs.org, open a terminal in this folder
  and run:   node server.js
  Then open  http://localhost:3000
  The leaderboard is then saved in data/players.json in this folder.
