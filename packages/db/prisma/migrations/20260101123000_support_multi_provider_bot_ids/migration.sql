-- Add provider-scoped identifiers to support multiple chat platforms.

-- User: viberUserId -> (provider, providerUserId)
ALTER TABLE "User" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'viber';
ALTER TABLE "User" ADD COLUMN "providerUserId" TEXT;

UPDATE "User" SET "providerUserId" = "viberUserId";

ALTER TABLE "User" ALTER COLUMN "providerUserId" SET NOT NULL;

DROP INDEX "User_viberUserId_key";
ALTER TABLE "User" DROP COLUMN "viberUserId";

CREATE UNIQUE INDEX "User_provider_providerUserId_key" ON "User"("provider", "providerUserId");

-- Chat: viberChatId -> (provider, providerChatId)
ALTER TABLE "Chat" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'viber';
ALTER TABLE "Chat" ADD COLUMN "providerChatId" TEXT;

UPDATE "Chat" SET "providerChatId" = "viberChatId";

ALTER TABLE "Chat" ALTER COLUMN "providerChatId" SET NOT NULL;

DROP INDEX "Chat_viberChatId_key";
ALTER TABLE "Chat" DROP COLUMN "viberChatId";

CREATE UNIQUE INDEX "Chat_provider_providerChatId_key" ON "Chat"("provider", "providerChatId");
