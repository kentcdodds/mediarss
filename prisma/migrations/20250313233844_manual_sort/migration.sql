-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Feed" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sort" TEXT NOT NULL DEFAULT 'pubDate',
    "sortDirection" TEXT NOT NULL DEFAULT 'descending',
    "overrides" JSONB,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "Feed_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Feed" ("createdAt", "description", "id", "name", "overrides", "ownerId", "sort", "sortDirection", "updatedAt") 
SELECT "createdAt", "description", "id", "name", "overrides", "ownerId", 'pubDate', "sortDirection", "updatedAt" 
FROM "Feed";
DROP TABLE "Feed";
ALTER TABLE "new_Feed" RENAME TO "Feed";
CREATE TABLE "new_FeedMedia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filePath" TEXT NOT NULL,
    "order" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "feedId" TEXT NOT NULL,
    CONSTRAINT "FeedMedia_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "Feed" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FeedMedia" ("createdAt", "feedId", "filePath", "id", "updatedAt") SELECT "createdAt", "feedId", "filePath", "id", "updatedAt" FROM "FeedMedia";
DROP TABLE "FeedMedia";
ALTER TABLE "new_FeedMedia" RENAME TO "FeedMedia";
CREATE INDEX "FeedMedia_feedId_idx" ON "FeedMedia"("feedId");
CREATE INDEX "FeedMedia_order_idx" ON "FeedMedia"("order");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
