PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
);
INSERT INTO _prisma_migrations VALUES('cc04dafd-9fce-440f-bc10-6ba244a62d45','39b78fb82ca4942ffc2028da0c866bd5be9e82526e49b103cc3a7598bb39bef5',1741819703636,'20250312224823_init',NULL,NULL,1741819703630,1);
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "Password" (
    "hash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Password_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expirationDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "Permission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "access" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO Permission VALUES('cm86ijgi90000dn8thlzi1xj3','create','user','own','',1741819806802,1741819806802);
INSERT INTO Permission VALUES('cm86ijgi90001dn8tuissj9es','create','user','any','',1741819806802,1741819806802);
INSERT INTO Permission VALUES('cm86ijgi90002dn8tm1lqrmbx','read','user','own','',1741819806802,1741819806802);
INSERT INTO Permission VALUES('cm86ijgi90003dn8tt1jixqin','read','user','any','',1741819806802,1741819806802);
INSERT INTO Permission VALUES('cm86ijgi90004dn8t7691rtmn','update','user','own','',1741819806802,1741819806802);
INSERT INTO Permission VALUES('cm86ijgi90005dn8tg0ax1zb5','update','user','any','',1741819806802,1741819806802);
INSERT INTO Permission VALUES('cm86ijgi90006dn8t9r8ad8zt','delete','user','own','',1741819806802,1741819806802);
INSERT INTO Permission VALUES('cm86ijgi90007dn8t55nddfwy','delete','user','any','',1741819806802,1741819806802);
CREATE TABLE IF NOT EXISTS "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO Role VALUES('cm86ijgic0008dn8t2ibhrxdh','admin','',1741819806805,1741819806805);
INSERT INTO Role VALUES('cm86ijgie0009dn8t7ub7icqp','user','',1741819806806,1741819806806);
CREATE TABLE IF NOT EXISTS "Verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "digits" INTEGER NOT NULL,
    "period" INTEGER NOT NULL,
    "charSet" TEXT NOT NULL,
    "expiresAt" DATETIME
);
CREATE TABLE IF NOT EXISTS "Passkey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "aaguid" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "publicKey" BLOB NOT NULL,
    "userId" TEXT NOT NULL,
    "webauthnUserId" TEXT NOT NULL,
    "counter" BIGINT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "transports" TEXT,
    CONSTRAINT "Passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "Feed" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sort" TEXT NOT NULL DEFAULT 'chronological',
    "sortDirection" TEXT NOT NULL DEFAULT 'descending',
    "overrides" JSONB,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "Feed_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "FeedImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT,
    "description" TEXT,
    "link" TEXT,
    "filePath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "feedId" TEXT NOT NULL,
    CONSTRAINT "FeedImage_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "Feed" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "FeedMedia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filePath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "feedId" TEXT NOT NULL,
    CONSTRAINT "FeedMedia_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "Feed" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "FeedSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    CONSTRAINT "FeedSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedSubscription_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "Feed" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "_PermissionToRole" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_PermissionToRole_A_fkey" FOREIGN KEY ("A") REFERENCES "Permission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_PermissionToRole_B_fkey" FOREIGN KEY ("B") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO _PermissionToRole VALUES('cm86ijgi90001dn8tuissj9es','cm86ijgic0008dn8t2ibhrxdh');
INSERT INTO _PermissionToRole VALUES('cm86ijgi90003dn8tt1jixqin','cm86ijgic0008dn8t2ibhrxdh');
INSERT INTO _PermissionToRole VALUES('cm86ijgi90005dn8tg0ax1zb5','cm86ijgic0008dn8t2ibhrxdh');
INSERT INTO _PermissionToRole VALUES('cm86ijgi90007dn8t55nddfwy','cm86ijgic0008dn8t2ibhrxdh');
INSERT INTO _PermissionToRole VALUES('cm86ijgi90000dn8thlzi1xj3','cm86ijgie0009dn8t7ub7icqp');
INSERT INTO _PermissionToRole VALUES('cm86ijgi90002dn8tm1lqrmbx','cm86ijgie0009dn8t7ub7icqp');
INSERT INTO _PermissionToRole VALUES('cm86ijgi90004dn8t7691rtmn','cm86ijgie0009dn8t7ub7icqp');
INSERT INTO _PermissionToRole VALUES('cm86ijgi90006dn8t9r8ad8zt','cm86ijgie0009dn8t7ub7icqp');
CREATE TABLE IF NOT EXISTS "_RoleToUser" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_RoleToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_RoleToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "Password_userId_key" ON "Password"("userId");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE UNIQUE INDEX "Permission_action_entity_access_key" ON "Permission"("action", "entity", "access");
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");
CREATE UNIQUE INDEX "Verification_target_type_key" ON "Verification"("target", "type");
CREATE INDEX "Passkey_userId_idx" ON "Passkey"("userId");
CREATE UNIQUE INDEX "FeedImage_feedId_key" ON "FeedImage"("feedId");
CREATE INDEX "FeedMedia_feedId_idx" ON "FeedMedia"("feedId");
CREATE INDEX "FeedSubscription_userId_idx" ON "FeedSubscription"("userId");
CREATE INDEX "FeedSubscription_feedId_idx" ON "FeedSubscription"("feedId");
CREATE UNIQUE INDEX "FeedSubscription_userId_feedId_key" ON "FeedSubscription"("userId", "feedId");
CREATE UNIQUE INDEX "_PermissionToRole_AB_unique" ON "_PermissionToRole"("A", "B");
CREATE INDEX "_PermissionToRole_B_index" ON "_PermissionToRole"("B");
CREATE UNIQUE INDEX "_RoleToUser_AB_unique" ON "_RoleToUser"("A", "B");
CREATE INDEX "_RoleToUser_B_index" ON "_RoleToUser"("B");
COMMIT;
