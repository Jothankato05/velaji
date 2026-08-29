# Why Vercel deploys get BLOCKED, and how to fix it permanently

> **Status: resolved on 29 August 2026.** `primerscorperation@gmail.com` is now a
> verified address on the Vercel account, so ordinary pushes deploy again. The
> rest of this page is kept because the failure is invisible from outside and
> will look identical if it ever recurs, for this project or another.

The pitch deck at **velaji-deck.vercel.app** deploys from `deck/` in this
repository on every push to `main`. In August 2026 every deploy after the first
came back with status `BLOCKED` — no build log, no error in the code, and the
live URL silently kept serving the very first version for hours while seven
newer ones piled up behind it.

This document is here so nobody has to diagnose that twice.

---

## What is actually wrong

Vercel refuses to build a git deployment when it cannot match the **commit
author's email** to a Vercel account with access to the project.

| | |
|---|---|
| Commits here are authored as | `primerscorperation@gmail.com` |
| The Vercel account is | `jothankato05` / `jerryjothan639@gmail.com` |

Both addresses belong to the same person. Vercel has no way to know that, so it
blocks the deploy rather than run someone else's code against your account.

The deployment record carries the giveaway:

```
"state": "BLOCKED",
"errorLink": "https://vercel.com/docs/deployments/troubleshoot-project-collaboration#account-configuration"
```

### Why it is easy to miss

Nothing looks broken. The push succeeds, GitHub is happy, the URL returns
**200**, and the page renders perfectly — it is simply the *old* page. Checking
that the site is up tells you nothing. Only the deployment's `state`, or
comparing live content against the repository, reveals it.

---

## The permanent fix (done, 29 August 2026)

1. Open **https://vercel.com/account** — your personal account settings, not the
   Primers team settings.
2. Find the **Email** section and add `primerscorperation@gmail.com` as an
   additional address on the account.
3. Open that inbox and click Vercel's verification link. It is not active until
   you do.

That is the whole fix. From then on, pushes authored with either address deploy
normally.

Two things worth knowing:

- **Already-blocked deployments do not retroactively build.** They stay blocked.
  The next push carries everything that was queued behind them.
- The address only needs to be on the **account**. You do not need to invite
  yourself to the team or change anything about the project.

---

## The stopgap (no longer needed)

Kept for reference only. Two commits in this repository's history carry the
Vercel-linked address for this reason and say so in their messages; that is why,
and it should not be repeated.

A single commit authored with the Vercel-linked address passes the check without
touching the repository's configured identity:

```bash
GIT_AUTHOR_NAME="Jothan Jerry Kato" GIT_AUTHOR_EMAIL="jerryjothan639@gmail.com" \
GIT_COMMITTER_NAME="Jothan Jerry Kato" GIT_COMMITTER_EMAIL="jerryjothan639@gmail.com" \
git commit --allow-empty -m "Trigger a deploy Vercel will accept" && git push
```

The environment variables apply to that one command only. `git config` is
untouched, and every other commit keeps the normal identity.

This is a workaround, not a fix — it has to be repeated for every deploy until
the email is added.

---

## Checking a deploy actually worked

Do not trust a 200. Compare the live page against what you just pushed:

```bash
# the live deck should carry all five portraits and no em dashes
curl -s https://velaji-deck.vercel.app | grep -c 'class="photo"'   # expect 5
curl -s https://velaji-deck.vercel.app | grep -o '—' | wc -l       # expect 0
curl -s https://velaji-deck.vercel.app | grep -o '<title>[^<]*</title>'
```

If those disagree with the repository, the deploy did not land, whatever the
status code says.

### A note on rate limiting

Polling these URLs in a tight loop trips Vercel's bot protection, and you will
start getting **403 "Vercel Security Checkpoint"** instead of the page. That is
your own traffic being challenged, not a problem with the site — a normal
browser is unaffected. Leave 15–20 seconds between checks.

---

## Where the pieces live

| What | Where |
|---|---|
| Pitch deck (static) | Vercel, from `deck/` |
| Prototype (API + SPA) | Render, from the repository root |
| Deck assets | `deck/assets/` — five portraits and the logo |

The two deploy independently. A blocked Vercel deploy never affects the
prototype, and vice versa.
