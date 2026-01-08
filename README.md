# Surveybot

A minimal survey web app to collect a 1-4 satisfaction rating, timestamp responses, and view issuer stats.

## Run

```sh
npm install
ISSUER_USERNAME=issuer ISSUER_PASSWORD=change-me SESSION_SECRET=dev-secret npm start
```

Open `http://localhost:3000`.

## Notes

- Survey data is stored in `data/surveybot.db`.
- Create issuer accounts at `/admin/signup`, then create surveys in `/admin`.
- Export responses per survey as CSV from the dashboard (respects active filters).
- Group surveys into categories and filter stats by date, weekday, week, or month.
- Category rollups are shown under the stats list and follow the same filters.
