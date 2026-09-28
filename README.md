# Read Together

https://github.com/user-attachments/assets/d96e232b-669e-41ce-957b-7511674e8a43

A web app for two people reading the same EPUB, each at their own pace.

**[Try it live](https://read-together-delta.vercel.app/)**

## Features

- Upload a DRM-free EPUB and invite a second reader with a room code.
- See your partner's position live and jump to their place.
- Share highlights, comments, and drawings.
- Read as a guest or use an email profile to resume across devices.

## Stack

Next.js · React · TypeScript · epub.js · Supabase

Next.js API routes handle room access and annotations. Books stay in private Supabase Storage; Realtime Presence shares reading positions. Database policies protect room data, and version-checked writes prevent concurrent updates from overwriting each other.

## Run locally

Requires Node.js 24 and Supabase. Follow the [setup guide](docs/setup-and-behavior.md#run-locally) to prepare the database and `.env.local`, then run:

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000).

[Setup & behavior](docs/setup-and-behavior.md) · [Tests & CI](docs/ci.md) · [Deployment](DEPLOYMENT.md)
