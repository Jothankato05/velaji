# Running the Velaji demo on a laptop

For pitching when the hosted prototype is not available. On 31 August 2026 an
account-level billing hold suspended every Render service, including this one, a
day before a pitch. Nothing in this file depends on Render, on Atlas, or on the
internet once the one-time setup below has been done.

Everything here was run end to end on 1 September 2026 and the outputs are real.

---

## What you get

One server on `http://localhost:4100` serving the API **and** the built UI, with
a seeded national dataset: **188 children, 1,721 doses, 67 overdue, 42 on
Healthy Start**, across real Nigerian states with Zamfara flagged priority.

The database is an **ephemeral in-memory MongoDB**. It is created at boot and
discarded on exit, which is what makes this safe to run anywhere: there is no
connection string, no credential, and no real child's data involved.

---

## One-time setup

Needs internet **once**, then never again.

```bash
cd /path/to/ncihap
npm ci
npm --prefix web ci
```

The first boot downloads a `mongod` binary (~77 MB) and caches it in
`~/.cache/mongodb-binaries/`. Check it is there before you travel:

```bash
ls ~/.cache/mongodb-binaries/
```

If that lists a `mongod-*` file, the demo runs fully offline from then on.

## Build the UI

The API serves whatever is in `web-dist/`, which is not in git, so build it
first. The two `VITE_DEMO_*` values are what pre-fill the sign-in form, so a
reviewer never has to be handed a password out of band.

The password itself is not written here. It is defined in the dev-only seeder,
`src/scripts/demoSeed.ts`, and printed on every boot, so read it from there — a
password copied into a committed document outlives the demo it was for:

```bash
cd /path/to/ncihap
DEMO_PASS=$(grep -oE "hashPassword\('[^']+'\)" src/scripts/demoSeed.ts | head -1 | sed "s/.*('\(.*\)').*//")
VITE_DEMO_USERNAME=admin VITE_DEMO_PASSWORD="$DEMO_PASS" npm --prefix web run build
rm -rf web-dist && cp -r web/dist web-dist
```

Rebuild this whenever the UI changes. Skipping it is the most likely reason the
page looks stale or the credentials are not filled in.

## Start it

```bash
cd /path/to/ncihap
ALLOW_IN_MEMORY_DB=true npm run seed:serve
```

It prints what you need, and the card link and phone number **change on every
run**, so read them from your own output rather than copying from here:

```
[db] Connected to an EPHEMERAL in-memory MongoDB (ALLOW_IN_MEMORY_DB=true). Data will not persist.
SEEDED API on 4100
ADMIN_LOGIN=admin / <printed here>
CARD_LINK=http://localhost:4100/mychild/NG-26-03-79569570?t=vkZmqi16WZTp
USSD_PHONE=+2348010000001
```

Stop with `Ctrl+C`. The database dies with the process; the next start reseeds
from scratch.

---

## The demo paths

| What to show | Where |
|---|---|
| Command Centre | `http://localhost:4100/login` — credentials are pre-filled, press Sign in |
| MyChild, the family view | the `CARD_LINK` line from your own output |
| USSD on a feature phone | see below |
| Verify a card | Command Centre → Verify Card |
| Point of care | Command Centre → Point of Care |

USSD has no UI, so drive it from a second terminal using the `USSD_PHONE` your
run printed. Note the path is `/webhooks/ussd`, not `/api/ussd`:

```bash
curl -s -X POST http://localhost:4100/webhooks/ussd \
  -H 'Content-Type: application/json' \
  -d '{"phoneNumber":"+2348010000001","text":""}'
```

Real reply from the seeded data:

```
CON Zara: On track
1. Next vaccine
2. Reward status
0. Exit
```

Send `"text":"1"` for the next vaccine, `"2"` for reward status.

---

## Check it before you walk in

```bash
curl -s http://localhost:4100/health   # {"ok":true,"service":"ncihap"}
curl -s http://localhost:4100/ready    # {"ready":true,"db":"connected"}
```

End to end, including that an unauthenticated call is properly refused:

```bash
TOKEN=$(curl -s -X POST http://localhost:4100/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$DEMO_PASS\"}" \
  | python -c "import sys,json;print(json.load(sys.stdin)['token'])")

curl -s -o /dev/null -w 'authed   %{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" http://localhost:4100/api/dashboard/summary
curl -s -o /dev/null -w 'unauthed %{http_code}\n' \
  http://localhost:4100/api/dashboard/summary
```

Expect `authed 200` and `unauthed 401`. If the second one returns 200, stop and
fix it before demoing.

---

## Things that will bite you

- **Data resets on every restart.** Do not record a CHIN during rehearsal and
  read it out during the pitch; it will not exist. Register a child live, or
  read the values from the current run.
- **`web-dist` is not in git.** A fresh clone serves no UI until you build it.
- **The demo credentials are compiled into the bundle at build time.** Build
  without the `VITE_DEMO_*` variables and the fields come up empty, which is
  deliberate so this convenience cannot follow the app to a real deployment.
- **Port 4100** must be free. `netstat -ano | grep :4100` to check.
- **`ALLOW_IN_MEMORY_DB` is refused in production.** `src/config/env.ts` will not
  boot with it set when `NODE_ENV=production`. That is intentional; do not work
  around it.
- **The service worker caches the shell.** After rebuilding the UI, hard-reload
  (`Ctrl+Shift+R`) or you may be looking at the previous build.

## If you would rather not present from localhost

The address bar says `localhost`, which some rooms read as "not really built".
Two options, in order of preference:

1. Clear the Render bill and use `velaji.onrender.com`. About $5.50.
2. Present from localhost and say plainly that it is running on the laptop with
   an ephemeral database and invented data. That is a stronger position than a
   screenshot, and it is true.

Do not substitute mocked screenshots for either. The product runs; show it
running.
