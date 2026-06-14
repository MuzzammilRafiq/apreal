- Sanity and do test for delete chat should be synced everywhere since chats live in server it should also delete it and wait for conformation.

- Sanity check for the TOKEN pairing

- ADD and test multiple server client pairing support

- Check the privacy and security

- Improve single-chat open/sync UX: when selecting a chat, render the IndexedDB snapshot immediately if present, then reconcile with the server in the background using per-chat revision. Avoid making the transcript feel stuck on remote relay latency, and verify refresh during/after streaming never falls back to an older saved snapshot longer than necessary.
