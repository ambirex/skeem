# Demo recording

`skeem-demo.tape` regenerates `docs/assets/skeem-demo.gif` (and the
`skeem-social.png` still) with [vhs](https://github.com/charmbracelet/vhs).

## Prerequisites

1. `npm run build` (the tape runs the CLI from `packages/skeem/dist`).
2. The Directus smoke fixture running on port 18055 with the `movies`
   collection provisioned. The cheapest way to get one is to run
   `npm run smoke:directus` once (it provisions and seeds everything), then:

   ```bash
   cd test/.tmp/directus-smoke/project && npx directus start
   ```

3. A demo workspace at `test/.tmp/demo-workspace/.skeemrc.yaml`:

   ```yaml
   adapter: directus
   connection:
     url: http://127.0.0.1:18055
     token: ${SKEEM_DEMO_TOKEN}

   sources:
     wikidata:
       adapter: wikidata
       connection:
         url: https://www.wikidata.org
   ```

   (The token is the fixture's throwaway admin token, `skeem-admin-token`,
   injected via env in the tape's hidden setup.)

## Record

```bash
brew install vhs
vhs demo/skeem-demo.tape
```

The tape hits the live WikiData API twice (Q42, Q83495) and writes one record
to the local fixture per run.
