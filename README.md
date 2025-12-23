# Smart Notes (frontend demo)

This is a small client-only demo app that stores notes in your browser and provides simple personalized recommendations based on note content.

Features:
- Add, view, and like notes
- Assign `Subject` and `Importance` to notes (help the recommender prioritize study material)
- Mark notes as "studied" (last-studied timestamp used to space recommendations)
- Search and filter notes by title, tags, subject, or content
- Import/Export notes as JSON for backup and sharing
- Recommendations computed with TF-IDF + cosine similarity combined with importance and recency
- Data persists in `localStorage` (no server or account required)

Files:
- `index.html` — main UI
- `styles.css` — styles
- `app.js` — application logic and recommendation algorithm

Run locally (PowerShell):

To open the page directly, double-click `index.html` in File Explorer or run:
```powershell
Start-Process .\"smart notes\"\index.html
```

To serve over a simple HTTP server (recommended for feature parity):
```powershell
cd "c:\Users\admin\OneDrive\Desktop\MUSIC-PROJECT\smart notes"; python -m http.server 8000
# then open http://localhost:8000 in your browser
```

Import / Export
- To export notes: click `Export` in the notes panel — a `smartnotes-export.json` file will be downloaded.
- To import notes: click `Import` and select a JSON file exported previously. Imported items will be appended to your notes.

Next steps you might ask me to do:
- Improve recommendation with time-decay and implicit feedback (views, time-on-note)
- Add spaced-repetition scheduling and study-session UI
- Add server sync (Node/Python) and account-based storage

If you want a different language or server scaffold, tell me which runtime and I will add it.
