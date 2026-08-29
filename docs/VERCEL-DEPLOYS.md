# Why Vercel deploys get BLOCKED, and how to fix it permanently

> **Status: resolved on 29 August 2026** by adding `primerscorperation@gmail.com`
> to the **GitHub** account, not the Vercel one. The rest of this page is kept
> because the failure is invisible from outside and will look identical if it
> ever recurs, for this project or another.

The pitch deck at **velaji-deck.vercel.app** deploys from `deck/` in this
repository on every push to `main`. In August 2026 every deploy after the first
came back with status `BLOCKED` — no build log, no error in the code, and the
live URL silently kept serving the very first version for hours while seven
newer ones piled up behind it.

This document is here so nobody has to diagnose that twice.

---

## What is actually wrong

Vercel will not build a git deployment it cannot attribute to a person. The
check runs on the **GitHub login** GitHub resolves the commit author to, not on
the raw email and not on the addresses held by the Vercel account.

GitHub can only resolve an author to a login when the commit's author email is a
verified address on that GitHub account. It was not, so GitHub handed Vercel a
commit belonging to nobody, and Vercel declined to run it.

The deployment records make this unambiguous. Across the fifteen deploys of the
blocked period the correlation is exact, with no exceptions either way:

| Commit authored as | `meta.githubCommitAuthorLogin` | Result |
|---|---|---|
| `jerryjothan639@gmail.com` | `Jothankato05` | READY, 4 of 4 |
| `primerscorperation@gmail.com` | *field absent* | BLOCKED, 11 of 11 |

The missing field is the whole diagnosis. `state` and `errorLink` only say the
deploy was refused:

```
"state": "BLOCKED",
"errorLink": "https://vercel.com/docs/deployments/troubleshoot-project-collaboration#account-configuration"
```

That link points at Vercel account configuration, which is what sent the first
investigation to the wrong settings page. Adding the address to the Vercel
account changed nothing, and the next push under the normal identity came back
blocked again, which is what isolated GitHub as the real owner of the check.

### Why it is easy to miss

Nothing looks broken. The push succeeds, GitHub is happy, the URL returns
**200**, and the page renders perfectly — it is simply the *old* page. Checking
that the site is up tells you nothing. Only the deployment's `state`, or
comparing live content against the repository, reveals it.

---

## The permanent fix (done, 29 August 2026)

1. Open **https://github.com/settings/emails**.
2. Add `primerscorperation@gmail.com` and verify it from that inbox. It does
   nothing until verified.

That is the whole fix, and it is on GitHub. Vercel needs no change at all.

Three things worth knowing:

- GitHub **back-attributes past commits** carrying that address to your login,
  so the repository's history stops being split between an attributed author and
  an anonymous one.
- **Already-blocked deployments do not retroactively build.** They stay blocked.
  The next push carries everything that was queued behind them.
- Adding the address on the **Vercel** side is harmless but irrelevant. It was
  tried first and did not unblock anything.

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

It also has a cost worth naming: it puts a second author identity into the
history for reasons that have nothing to do with the code, which is exactly the
confusion the permanent fix removes.

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

The strongest single check is a straight diff, remembering that the working copy
is CRLF and what Vercel serves is not:

```bash
diff <(curl -s https://velaji-deck.vercel.app | tr -d '\r') \
     <(tr -d '\r' < deck/index.html) && echo "live deck matches the repository"
```

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
