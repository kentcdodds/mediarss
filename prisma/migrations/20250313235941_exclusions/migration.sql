-- CreateTable
CREATE TABLE "FeedMediaExclusion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filePath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "feedId" TEXT NOT NULL,
    CONSTRAINT "FeedMediaExclusion_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "Feed" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FeedMediaExclusion_feedId_idx" ON "FeedMediaExclusion"("feedId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedMediaExclusion_feedId_filePath_key" ON "FeedMediaExclusion"("feedId", "filePath");
