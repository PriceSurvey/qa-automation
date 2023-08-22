import { JsonDB, Config } from "node-json-db";

// The first argument is the database filename. If no extension is used, '.json' is assumed and automatically added.
// The second argument is used to tell the DB to save after each push
// If you set the second argument to false, you'll have to call the save() method.
// The third argument is used to ask JsonDB to save the database in a human readable format. (default false)
// The last argument is the separator. By default it's slash (/)
export enum CrawlerState {
  NOT_RUNNING = "NOT_RUNNING",
  RUNNING = "RUNNING",
}

type Schema = {
  crawlerState: CrawlerState;
};

export const db = new JsonDB(new Config("database", true, false, "/"));
// export const db = new LowSync<Schema>(new JSONFileSync("./database.json"), {
//   crawlerState: "NOT_RUNNING" as CrawlerState,
// } as any);
