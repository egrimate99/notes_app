# Math Atlas working instructions

- Before handing work back to the user, ensure the Math Atlas development server is running at `http://127.0.0.1:1420`.
- Reuse an existing Math Atlas listener on port 1420 instead of starting a duplicate.
- Start the server in a hidden background process and leave it running unless the user explicitly asks to stop it.
- Verify both the application root and `/api/content/tree` respond before reporting completion.
- The external Obsidian vault remains read-only. Canonical writable notes live only below `study/content`.
