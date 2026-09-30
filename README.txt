MIGUEL'S CASINO: PUTTING IT ON THE INTERNET
==========================================

What's in this folder
  server.js      the server: shows the casino and keeps the live leaderboard
  package.json   tells the hosting service how to start the server
  public/        the casino itself (lobby, blackjack, roulette, craps)

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
     folder: server.js, package.json, README.txt and the public folder.
     Check that the list shows public/index.html, public/blackjack.html,
     public/roulette.html and public/craps.html.
  4. Click "Commit changes".


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
  You should see  "ok":true  and  "storage":"upstash".
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


PLAY ON YOUR OWN COMPUTER INSTEAD
  Install Node.js from https://nodejs.org, open a terminal in this folder
  and run:   node server.js
  Then open  http://localhost:3000
  The leaderboard is then saved in data/players.json in this folder.
