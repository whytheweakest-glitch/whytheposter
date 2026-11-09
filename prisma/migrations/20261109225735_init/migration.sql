-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "telegram_user_id" BIGINT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "can_approve" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    "user_agent" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "login_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "login_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "telegram_chat_id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "is_publish_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description_for_ai" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '#888888',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "telegram_updates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "update_id" BIGINT NOT NULL,
    "from_user_id" BIGINT,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "processed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "materials" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_id" TEXT NOT NULL,
    "telegram_update_id" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'inbox',
    "original_url" TEXT,
    "normalized_url_hash" TEXT,
    "content_hash" TEXT,
    "title" TEXT,
    "source_author" TEXT,
    "source_name" TEXT,
    "source_published_at" DATETIME,
    "owner_note" TEXT,
    "text" TEXT,
    "extracted_text" TEXT,
    "summary" TEXT,
    "category_id" TEXT,
    "category_confidence" REAL,
    "category_set_by" TEXT,
    "topic" TEXT,
    "processing_error" TEXT,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "materials_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "materials_telegram_update_id_fkey" FOREIGN KEY ("telegram_update_id") REFERENCES "telegram_updates" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "materials_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "material_id" TEXT,
    "post_id" TEXT,
    "kind" TEXT NOT NULL,
    "storage_key" TEXT,
    "sha256" TEXT,
    "mime" TEXT,
    "size_bytes" INTEGER,
    "file_name" TEXT,
    "telegram_file_id" TEXT,
    "telegram_file_unique_id" TEXT,
    "download_error" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attachments_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "attachments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ideas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "category_id" TEXT,
    "origin_material_id" TEXT,
    "deleted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "ideas_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ideas_origin_material_id_fkey" FOREIGN KEY ("origin_material_id") REFERENCES "materials" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "channel_id" TEXT,
    "category_id" TEXT,
    "format" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT NOT NULL DEFAULT '',
    "content_hash" TEXT NOT NULL DEFAULT '',
    "scheduled_at" DATETIME,
    "publish_attempt_id" TEXT,
    "publish_lease_until" DATETIME,
    "telegram_message_ids" TEXT,
    "published_at" DATETIME,
    "published_url" TEXT,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "posts_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "posts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "post_materials" (
    "post_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,

    PRIMARY KEY ("post_id", "material_id"),
    CONSTRAINT "post_materials_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "post_materials_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "drafts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "post_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "ai_generation_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drafts_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "drafts_ai_generation_id_fkey" FOREIGN KEY ("ai_generation_id") REFERENCES "ai_generations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "post_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "scheduled_for" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approvals_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "approvals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "publish_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "post_id" TEXT NOT NULL,
    "approval_id" TEXT NOT NULL,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" DATETIME,
    "outcome" TEXT,
    "telegram_error_code" INTEGER,
    "error_text" TEXT,
    "message_ids" TEXT,
    CONSTRAINT "publish_attempts_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ai_generations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "output" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "duration_ms" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "active_dedup_key" TEXT,
    "dedup_key" TEXT,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "run_after" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" DATETIME,
    "locked_by" TEXT,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_type" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "data" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "reference_posts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "message_id" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "text" TEXT NOT NULL,
    "category_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_user_id_key" ON "users"("telegram_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "login_tokens_token_hash_key" ON "login_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "channels_telegram_chat_id_key" ON "channels"("telegram_chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "sources_kind_key" ON "sources"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_updates_update_id_key" ON "telegram_updates"("update_id");

-- CreateIndex
CREATE UNIQUE INDEX "materials_normalized_url_hash_key" ON "materials"("normalized_url_hash");

-- CreateIndex
CREATE INDEX "materials_status_created_at_idx" ON "materials"("status", "created_at");

-- CreateIndex
CREATE INDEX "materials_category_id_created_at_idx" ON "materials"("category_id", "created_at");

-- CreateIndex
CREATE INDEX "materials_content_hash_idx" ON "materials"("content_hash");

-- CreateIndex
CREATE INDEX "attachments_sha256_idx" ON "attachments"("sha256");

-- CreateIndex
CREATE INDEX "attachments_telegram_file_unique_id_idx" ON "attachments"("telegram_file_unique_id");

-- CreateIndex
CREATE UNIQUE INDEX "posts_publish_attempt_id_key" ON "posts"("publish_attempt_id");

-- CreateIndex
CREATE INDEX "posts_status_scheduled_at_idx" ON "posts"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "posts_published_at_idx" ON "posts"("published_at");

-- CreateIndex
CREATE UNIQUE INDEX "drafts_post_id_version_key" ON "drafts"("post_id", "version");

-- CreateIndex
CREATE INDEX "approvals_post_id_created_at_idx" ON "approvals"("post_id", "created_at");

-- CreateIndex
CREATE INDEX "publish_attempts_post_id_idx" ON "publish_attempts"("post_id");

-- CreateIndex
CREATE INDEX "ai_generations_subject_type_subject_id_idx" ON "ai_generations"("subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_active_dedup_key_key" ON "jobs"("active_dedup_key");

-- CreateIndex
CREATE INDEX "jobs_status_run_after_idx" ON "jobs"("status", "run_after");

-- CreateIndex
CREATE INDEX "activity_logs_entity_type_entity_id_created_at_idx" ON "activity_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reference_posts_channel_message_id_key" ON "reference_posts"("channel", "message_id");
