# Demo Clips

Two clips are required for the submission. This directory holds the capture
recipes. A browser + display are required to record them (headless environments
can't), so run these on your own machine.

## Prerequisites

```bash
npm install
npm run prod        # everything on http://localhost:8787
```

Use any screen recorder (OBS, QuickTime, GNOME Screen Recorder) or ffmpeg with
X11 capture:

```bash
# Linux (X11), 30fps, follow the window
ffmpeg -f x11grab -framerate 30 -video_size 1280x800 -i :0.0 -t 30 \
  -pix_fmt yuv420p demo-clips/approval-gate.mp4
```

---

## Clip 1 — Approval gate (30s) → `demo-clips/approval-gate.mp4`

The demo climax: a carrier reaches the pedestal, the modal appears, a human
approves, confetti.

1. Open http://localhost:8787, click **Single Player** (you + 3 scripted bots).
2. Play normally (search furniture, hide from Gronk) until a bot on your team
   finds the treasure and carries it to the pedestal — or grab it yourself.
3. The modal appears: **"TEAM X IS BANKING THE TREASURE!" [Approve] [Reject]**.
4. Click **Approve**.
5. Result screen: "Team X wins! Treasure banked with approval." + confetti.

```bash
ffmpeg -f x11grab -framerate 30 -video_size 1280x800 -i :0.0 -t 30 \
  -pix_fmt yuv420p demo-clips/approval-gate.mp4
```

## Clip 2 — Session resume (15s) → `demo-clips/session-resume.mp4`

1. Open http://localhost:8787, click **Single Player**, play for a few seconds.
2. Refresh the browser (F5 / Cmd+R) mid-match.
3. Confirm you resume as the same wizard, same position, match continues.

```bash
ffmpeg -f x11grab -framerate 30 -video_size 1280x800 -i :0.0 -t 15 \
  -pix_fmt yuv420p demo-clips/session-resume.mp4
```

## Bonus — server-restart behavior

Kill the game server (`Ctrl+C` on the `npm run prod` process) mid-match: the
frontend shows **"Reconnecting…"** and retries. Because lobbies are in-memory,
a full restart loses the room — after a few retries the UI offers **"Room no
longer exists" → Back to Title**. A fresh match starts in one click.
