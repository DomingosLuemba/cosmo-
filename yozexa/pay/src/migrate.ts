/** Apply database migrations: `npm run migrate`. */
import { migrate, openPool } from "@yozexa/indexer";

import { loadConfig } from "./config.js";
import { migrationsDir } from "./paths.js";

const config = loadConfig();
const pool = openPool({ connectionString: config.databaseUrl });
const ran = await migrate(pool, migrationsDir());
console.log(ran.length > 0 ? `applied: ${ran.join(", ")}` : "database already up to date");
await pool.end();
