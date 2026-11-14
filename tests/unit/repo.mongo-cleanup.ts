import { MongoServerError, type Db } from "mongodb";

function dropDatabaseDenied(error: unknown): boolean {
  if (!(error instanceof MongoServerError)) return false;
  return error.code === 13 || error.codeName === "Unauthorized" || (
    error.code === 8000 && /not allowed to do action \[dropDatabase\]/i.test(error.message)
  );
}

/**
 * readWrite permits dropCollection, but dropDatabase requires an extra privilege:
 * https://www.mongodb.com/docs/compass/connect/required-access/
 * Cleanup succeeds only after the generated database is absent, on either path.
 */
export async function dropTestDatabase(db: Db): Promise<void> {
  if (!/^repo_[a-f0-9]{32}$/.test(db.databaseName)) {
    throw new Error("Refusing to clean a database that is not a generated Repo test database");
  }

  try {
    await db.dropDatabase();
  } catch (error: unknown) {
    if (!dropDatabaseDenied(error)) throw error;
    // This database belongs to this test. Drop its collections (including GridFS)
    // with read/write privileges, then verify that MongoDB removed the database.
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    for (const { name } of collections) await db.dropCollection(name);
  }

  const remaining = await db.listCollections({}, { nameOnly: true }).toArray();
  if (remaining.length) throw new Error(`Test database cleanup left collections in ${db.databaseName}`);
  const { databases } = await db.admin().listDatabases({
    filter: { name: db.databaseName }, nameOnly: true, authorizedDatabases: true,
  });
  if (databases.length) throw new Error(`Test database cleanup incomplete: ${db.databaseName} still exists`);
}
