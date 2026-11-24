<div align="center">

# Spellbook Ledger

**A cozy, offline-first collection manager and Commander deck builder for Magic: The Gathering.**

Import your collection from a ManaBox CSV, search it like Scryfall, and build decks laid out in mana value piles,
with format rules checked for you.

<!-- Add a screenshot: save one to docs/screenshots/collection.png and uncomment the line below -->
<!-- ![Spellbook Ledger collection view](docs/screenshots/collection.png) -->

</div>

---

## Contents

- [Features](#features)
- [Getting started](#getting-started)
- [Importing your collection](#importing-your-collection)
- [Search syntax](#search-syntax)
- [Building decks](#building-decks)
- [Editing your collection](#editing-your-collection)
- [Card details and art](#card-details-and-art)
- [Your data](#your-data)
- [Building the desktop app](#building-the-desktop-app)
- [Project structure](#project-structure)
- [Credits and legal](#credits-and-legal)
- [License](#license)

## Features

**Collection**
- Import a ManaBox CSV export, then **replace** or **merge** with later scans. Your decks and tags survive every re-import.
- Grid and list views. Copies of the same card stack into one tile, with foils and regular copies listed separately.
- Filter by rarity, set, finish and tag. Sort by name, price, value, rarity, set or date added.
- A powerful [search syntax](#search-syntax) for type, mana value, color identity, price and more.
- Tag cards ("Trade binder", "Lent to Dad") one at a time or in bulk.
- A detail view where the card sits large in the center and tilts toward your mouse, with a holo shimmer on foils.

**Deck building**
- Commander, Brawl and Historic Brawl, plus Standard, Pioneer, Modern, Pauper, Limited and Casual.
- MTGO-style **piles by mana value** (or by card type), or a plain list.
- A commander picker that shows only the legendaries you own, with partner and Background support.
- **Format rules are enforced**: one copy of each card, only your commander's colors, and the right deck size. The maybeboard is always free for ideas.
- **Placeholder basic lands**, so you don't need to scan your lands.
- Owned / need counts on every card. Pick exactly which copy goes in a deck: the foil, the old border, whichever.
- Warns you before putting a copy that's already in another deck into a second one, and marks it as a proxy if you go ahead.
- Paste a decklist in, or export one to share.

**Everything else**
- Collection stats: value, rarity breakdown, biggest sets, most valuable cards.
- A separate **Edit collection** tab for one-off fixes: add cards straight from Scryfall, correct counts, or remove cards you traded away.
- Runs in any modern browser, or as a desktop app for Windows and Mac.
- All your data stays on your computer.

## Getting started

### In a browser

No install needed. Download or clone this repository and open `index.html` in Chrome, Edge, Firefox or Safari.

```bash
git clone https://github.com/<your-username>/spellbook-ledger.git
cd spellbook-ledger
open index.html        # macOS
start index.html       # Windows
```

### As a desktop app

See [Building the desktop app](#building-the-desktop-app).

## Importing your collection

On first launch, Spellbook Ledger asks for your collection. Drag a CSV onto the window or click to choose one.

The importer expects the column layout of a **ManaBox** collection export:

```
Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Signed,Condition,Language,Proxy,Purchase price currency,Added
```

Only `Name` is required. Other columns are used when present. For the full format, see [docs/csv-format.md](docs/csv-format.md).

When you import again later:

| Option | Use it when | What happens |
| --- | --- | --- |
| **Replace** | You exported your whole collection again | The file becomes your collection. Tags carry over to matching cards. |
| **Merge** | The file only has newly scanned cards | Quantities are added on top of what you have. |

If **Replace** would leave a deck without enough copies of a card, you'll see the affected cards and get a chance to go back or merge instead. Decks are never changed by an import.

## Search syntax

Plain words search card names. Combine any of these; every term must match.

| Search | Finds |
| --- | --- |
| `dragon` | Names containing "dragon" |
| `"think twice"` | An exact phrase |
| `set:fdn` | A set code, or part of a set name |
| `r:rare` · `r:m` | Rarity (c, u, r, m) |
| `is:foil` · `is:nonfoil` · `is:etched` | Finish |
| `is:signed` · `is:altered` · `is:misprint` · `is:proxy` | Card flags |
| `is:tagged` · `tag:trade` | Tagged cards, or a specific tag |
| `not:foil` | Negates any `is:` filter |
| `price>1` · `price<=0.25` | Purchase price |
| `qty>=4` | Copies owned |
| `lang:ja` · `cond:lp` | Language or condition |
| `cn:123` | Collector number |
| `mv=3` · `mv>=5` | Mana value * |
| `type:dragon` | Type line contains * |
| `is:legendary` · `is:commander` | Legendaries, or cards that can be your commander * |
| `id:wub` | Fits within a color identity * |

\* Needs card details, which are loaded automatically. See [Card details and art](#card-details-and-art).

Press <kbd>/</kbd> to jump to the search box, or click **?** next to it for this list.

## Building decks

1. Open **Decks** and click **New deck**. Choose a format.
2. For Commander and Brawl you'll be asked to **choose your commander** from the legendaries you own.
3. Add cards from the search panel on the right. It only shows cards in your commander's colors by default.
4. Add **basic lands** with the counters in the right column.
5. Switch between **Piles** and **List**, and group piles by mana value or card type.

The stats bar shows the card count, lands, creatures, average mana value, value, missing copies and anything off-color.

### Format rules

For Commander, Brawl and Historic Brawl:

- **Singleton.** One copy of each card. Basic lands are exempt, as are cards that allow any number of copies (Relentless Rats) or a set number (Seven Dwarves).
- **Color identity.** Every card must fit your commander's colors. Changing your commander moves cards that no longer fit to the maybeboard.
- **Deck size.** 100 cards for Commander and Historic Brawl, 60 for Brawl, commander included.

The maybeboard ignores all rules, so it's a safe place to park ideas.

### Owning versus using

Each card in a deck shows whether you own it (`own 2`) or are short (`need 1`). If a copy is already used in another deck and you have no spare, you'll be warned before reusing it. If you continue, it's marked **proxy** in that deck.

## Editing your collection

The **✎ Edit collection** tab, top right, is separated from everything else so nothing changes by accident.

- **Add cards from Scryfall.** Search any card, pick the exact printing and finish, and set quantity, price, condition and language.
- **Correct or remove cards you own.** Adjust counts or remove a printing entirely. If a deck uses the card, you'll be told which one first.
- **Recent changes** lists every manual edit.

> **Note:** a full **Replace** import makes the CSV your whole collection again, which undoes manual edits that aren't in the file. Use **Merge** for partial scans.

## Card details and art

ManaBox exports don't include mana values, types or rules text, so Spellbook Ledger looks them up from [Scryfall](https://scryfall.com) using the Scryfall ID in your CSV.

- **Online (default).** Details are fetched automatically in the background and saved on your computer.
- **Offline.** Download the **Oracle Cards** file from [Scryfall's bulk data page](https://scryfall.com/docs/api/bulk-data) and load it under **Data → Card details**. The app reads it locally and keeps only the cards you own.

**Card art** inside each card frame comes from Scryfall's art crops for that exact printing. You can turn it off in **Settings** (the gear, top right).

## Your data

Everything is stored in your browser or desktop app on your own computer. Nothing is uploaded anywhere. The app only contacts Scryfall to look up card data and art.

- **Data → Download full backup** saves your collection, tags, decks and edit history as one `.json` file.
- **Data → Restore a backup** loads it into another browser or computer.
- **Data → Export collection CSV** writes your collection back out in the import format.

The browser version and the desktop app keep separate storage. Use a backup to move between them.

## Building the desktop app

Spellbook Ledger uses [Electron](https://www.electronjs.org/) to run as a desktop app.

**Requirements:** [Node.js](https://nodejs.org/) LTS.

```bash
npm install          # installs Electron and the packager (first time only)
npm start            # run the desktop app
npm run package-win  # build for Windows (x64)
npm run package-mac  # build for macOS (Apple silicon and Intel)
```

Builds go to `dist/`. For Windows, share the whole `dist/Spellbook Ledger-win32-x64/` folder (zipped). `Spellbook Ledger.exe` needs the files next to it.

> Windows may show **"Windows protected your PC"** because the app isn't code-signed. Click **More info → Run anyway**.

## Project structure

```
spellbook-ledger/
├── index.html        # Page shell and header
├── styles.css        # All styling
├── data.js           # CSV import/export, storage, search, settings, Scryfall lookups
├── views.js          # Collection grid, card faces, detail view, stats
├── decks.js          # Deck builder, piles, commander picker, format rules, basic lands
├── app.js            # Actions, menus, imports, backups, settings, intro animation
├── edit.js           # Edit collection tab
├── main.js           # Electron desktop window
├── package.json      # Desktop build scripts
└── docs/
    └── csv-format.md # Import file format
```

It's plain HTML, CSS and JavaScript, with no framework and no build step for the web version.

## Contributing

Bug reports and ideas are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits and legal

- Card data and art are provided by **[Scryfall](https://scryfall.com)**. Please follow Scryfall's [API guidelines](https://scryfall.com/docs/api) if you build on this project.
- Spellbook Ledger is unofficial Fan Content permitted under the [Wizards of the Coast Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). It is not approved or endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
- Magic: The Gathering, card names, mana symbols and card art are trademarks and copyrights of Wizards of the Coast LLC and their respective artists.
- Not affiliated with ManaBox. "ManaBox" refers only to the CSV format the importer reads.

## License

The source code is released under the [MIT License](LICENSE). The license covers this project's code only, not Magic: The Gathering card data, names or artwork.

