-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Password" (
    "hash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Password_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expirationDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "access" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Verification" (
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

-- CreateTable
CREATE TABLE "Passkey" (
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

-- CreateTable
CREATE TABLE "Feed" (
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

-- CreateTable
CREATE TABLE "FeedImage" (
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

-- CreateTable
CREATE TABLE "FeedMedia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filePath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "feedId" TEXT NOT NULL,
    CONSTRAINT "FeedMedia_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "Feed" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    CONSTRAINT "FeedSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedSubscription_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "Feed" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_PermissionToRole" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_PermissionToRole_A_fkey" FOREIGN KEY ("A") REFERENCES "Permission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_PermissionToRole_B_fkey" FOREIGN KEY ("B") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_RoleToUser" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_RoleToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_RoleToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Password_userId_key" ON "Password"("userId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_action_entity_access_key" ON "Permission"("action", "entity", "access");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Verification_target_type_key" ON "Verification"("target", "type");

-- CreateIndex
CREATE INDEX "Passkey_userId_idx" ON "Passkey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedImage_feedId_key" ON "FeedImage"("feedId");

-- CreateIndex
CREATE INDEX "FeedMedia_feedId_idx" ON "FeedMedia"("feedId");

-- CreateIndex
CREATE INDEX "FeedSubscription_userId_idx" ON "FeedSubscription"("userId");

-- CreateIndex
CREATE INDEX "FeedSubscription_feedId_idx" ON "FeedSubscription"("feedId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedSubscription_userId_feedId_key" ON "FeedSubscription"("userId", "feedId");

-- CreateIndex
CREATE UNIQUE INDEX "_PermissionToRole_AB_unique" ON "_PermissionToRole"("A", "B");

-- CreateIndex
CREATE INDEX "_PermissionToRole_B_index" ON "_PermissionToRole"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_RoleToUser_AB_unique" ON "_RoleToUser"("A", "B");

-- CreateIndex
CREATE INDEX "_RoleToUser_B_index" ON "_RoleToUser"("B");

-- Manual Seeding
INSERT INTO Permission VALUES('cm86ijgi90000dn8thlzi1xj3','create','user','own','',1741819806802,1741819806802);
INSERT INTO Permission VALUES('cm86ijgi90001dn8tuissj9es','create','user','any','',1741819806802,1741819806802);
INSERT INTO Permission VALUES('cm86ijgi90002dn8tm1lqrmbx','read','user','own','',1741819806802,1741819806802);
INSERT INTO Permission VALUES('cm86ijgi90003dn8tt1jixqin','read','user','any','',1741819806802,1741819806802);
INSERT INTO Permission VALUES('cm86ijgi90004dn8t7691rtmn','update','user','own','',1741819806802,1741819806802);
INSERT INTO Permission VALUES('cm86ijgi90005dn8tg0ax1zb5','update','user','any','',1741819806802,1741819806802);
INSERT INTO Permission VALUES('cm86ijgi90006dn8t9r8ad8zt','delete','user','own','',1741819806802,1741819806802);
INSERT INTO Permission VALUES('cm86ijgi90007dn8t55nddfwy','delete','user','any','',1741819806802,1741819806802);
INSERT INTO Role VALUES('cm86ijgic0008dn8t2ibhrxdh','admin','',1741819806805,1741819806805);
INSERT INTO Role VALUES('cm86ijgie0009dn8t7ub7icqp','user','',1741819806806,1741819806806);
INSERT INTO _PermissionToRole VALUES('cm86ijgi90001dn8tuissj9es','cm86ijgic0008dn8t2ibhrxdh');
INSERT INTO _PermissionToRole VALUES('cm86ijgi90003dn8tt1jixqin','cm86ijgic0008dn8t2ibhrxdh');
INSERT INTO _PermissionToRole VALUES('cm86ijgi90005dn8tg0ax1zb5','cm86ijgic0008dn8t2ibhrxdh');
INSERT INTO _PermissionToRole VALUES('cm86ijgi90007dn8t55nddfwy','cm86ijgic0008dn8t2ibhrxdh');
INSERT INTO _PermissionToRole VALUES('cm86ijgi90000dn8thlzi1xj3','cm86ijgie0009dn8t7ub7icqp');
INSERT INTO _PermissionToRole VALUES('cm86ijgi90002dn8tm1lqrmbx','cm86ijgie0009dn8t7ub7icqp');
INSERT INTO _PermissionToRole VALUES('cm86ijgi90004dn8t7691rtmn','cm86ijgie0009dn8t7ub7icqp');
INSERT INTO _PermissionToRole VALUES('cm86ijgi90006dn8t9r8ad8zt','cm86ijgie0009dn8t7ub7icqp');

-- Create admin user
INSERT INTO User VALUES('cm86ijgif000adn8t1234abcd','admin',NULL,1741819806807,1741819806807);

-- Create admin password (hash of "mediarss")
INSERT INTO Password VALUES('$2b$10$M4LCyrHIMdrP815JIC1GK.rq1qItlJiSgK2C9z5EH31R/9WWGM9vK','cm86ijgif000adn8t1234abcd');

-- Assign admin role to admin user
INSERT INTO _RoleToUser VALUES('cm86ijgic0008dn8t2ibhrxdh','cm86ijgif000adn8t1234abcd');
