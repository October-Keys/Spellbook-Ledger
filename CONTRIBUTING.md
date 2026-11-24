# Contributing

Thanks for wanting to help with Spellbook Ledger!

## Reporting a bug

Open an issue and include:

- What you did, what you expected, and what happened instead
- Whether you were using the browser version (and which browser) or the desktop app
- A screenshot if it's visual
- If it's about importing, a few sample rows from your CSV (remove anything private)

## Suggesting a feature

Open an issue describing what you'd like to do and why. Mockups and examples from other apps are welcome.

## Working on the code

The web version is plain HTML, CSS and JavaScript with no build step.

```bash
git clone https://github.com/<your-username>/spellbook-ledger.git
cd spellbook-ledger
open index.html      # or double-click it
```

For the desktop app:

```bash
npm install
npm start
```

### Where things live

| File | What's in it |
| --- | --- |
| `data.js` | Storage, CSV parsing, search syntax, settings, Scryfall lookups |
| `views.js` | Card face drawing, collection grid, detail view, stats |
| `decks.js` | Deck builder, piles, commander picker, format rules |
| `app.js` | Button actions, menus, import flow, backups, settings |
| `edit.js` | Edit collection tab |
| `styles.css` | All styling. The **Polish pass** section near the end holds the shared spacing, radius and control styles. |

### Conventions

- Buttons and links trigger actions with `data-act="actionName"`, handled in the `ACT` object in `app.js`.
- Inputs use `data-on="name"`, handled in `INPUTS` (as you type) or `CHANGES` (on change).
- To add a setting, add a row to `SETTINGS` in `app.js` and a default to `PREF_DEFAULTS` in `data.js`.
- Respect Scryfall's [API guidelines](https://scryfall.com/docs/api): batch requests, keep the delay between them, and don't hammer the API.

### Pull requests

1. Fork the repo and create a branch from `main`.
2. Keep changes focused. One feature or fix per pull request.
3. Test in at least one browser, and in the desktop app if you touched `main.js` or storage.
4. Describe what changed and why, with screenshots for anything visual.

## Code of conduct

Be kind and assume good intent.
