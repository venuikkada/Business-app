import { migrate } from "../src/migrate";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error("Set MIGRATION_DATABASE_URL to a connection string for the schema owner role.");
  process.exit(1);
}
migrate(url)
  .then((a) => console.log(a.length ? `Applied ${a.length} migration(s).` : "Database is up to date."))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
