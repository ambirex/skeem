# VHS tape for docs/assets/skeem-demo.gif (https://github.com/charmbracelet/vhs)
# Prerequisites + regen instructions: see demo/README.md
# Run from the repo root: vhs demo/skeem-demo.tape

Require node
Require jq

Output docs/assets/skeem-demo.gif

Set FontSize 16
Set Width 1200
Set Height 660
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 25ms

Hide
Type "cd test/.tmp/demo-workspace && alias skeem='node ../../../packages/skeem/dist/bin/skeem.js' && export SKEEM_DEMO_TOKEN=skeem-admin-token && clear"
Enter
Show

Type "# public reference data, straight from the CLI - no backend, no API key"
Enter
Sleep 600ms
Type "skeem get items Q42 --adapter wikidata --url https://www.wikidata.org --json | jq '{label: .data.label, externalIds: .data.externalIds | {imdb, viaf, musicbrainz_artist, openlibrary}}'"
Enter
Sleep 4.5s

Screenshot docs/assets/skeem-social.png

Type "clear"
Enter

Type "# point it at your own backend, and name reference sources in the config"
Enter
Sleep 600ms
Type "cat .skeemrc.yaml"
Enter
Sleep 3s

Type "skeem describe movies"
Enter
Sleep 3s

Type "clear"
Enter

Type "# --enrich folds the reference record into the write: look it up, don't make it up"
Enter
Sleep 600ms
Type "skeem create movies --enrich wikidata:items:Q83495 --map label=title --map description=overview --map externalIds.imdb=imdb_id --json"
Enter
Sleep 5.5s

Sleep 2s
