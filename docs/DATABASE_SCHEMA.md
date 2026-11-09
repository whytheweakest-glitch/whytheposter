# DATABASE_SCHEMA — WHYTHEWEAKEST OS

Prisma 6, SQLite для MVP, переносимо на PostgreSQL (см. TECHNICAL_ARCHITECTURE.md, раздел 9).

Общие правила:
- Первичные ключи `id` строкой (cuid2), у всех таблиц `created_at`, у изменяемых `updated_at`.
- Статусы хранятся строками, допустимые значения проверяются zod и описаны ниже.
- JSON хранится как текст с zod-валидацией.
- Удаление пользовательских данных мягкое (`deleted_at`), окончательная очистка отдельным действием. Каскадное удаление включено только для служебных дочерних записей.
- Таблицы `activity_logs` и `approvals` только для добавления: код не делает по ним UPDATE и DELETE.

Таблицы из раздела 10 ТЗ отмечены ●, дополнительные ○.

## 1. Доступ

### ● users
| Поле | Тип | Примечание |
|---|---|---|
| telegram_user_id | bigint, **unique** | Главный идентификатор |
| display_name | text | Псевдоним, не настоящее имя |
| role | text | `owner` \| `admin` |
| can_approve | bool | Право подтверждать публикации. У `owner` всегда true |
| is_active | bool | |

Владелец также задаётся в `.env` (`OWNER_TELEGRAM_IDS`); при старте запись синхронизируется. Отключить владельца из интерфейса нельзя.

### ○ sessions
`user_id` → users, `token_hash` **unique**, `expires_at`, `revoked_at`, `user_agent`, `ip_hash`.

### ○ login_tokens
Одноразовые ссылки входа из бота. `token_hash` **unique**, `user_id`, `expires_at` (5 минут), `used_at`. Повторное использование отклоняется.

## 2. Каналы и категории

### ● channels
| Поле | Тип | Примечание |
|---|---|---|
| telegram_chat_id | bigint, **unique** | |
| title, username | text | |
| kind | text | `main` \| `test` |
| is_publish_enabled | bool | Для `main` по умолчанию false, включает только владелец |
| bot_is_admin_checked_at | datetime | Последняя проверка прав бота |

### ● categories
`slug` **unique**, `name`, `description_for_ai`, `color`, `sort_order`, `is_active`. Удаление запрещено при наличии связей (RESTRICT), только `is_active = false`.

## 3. Входящие

### ● sources
Откуда пришёл материал. `kind`: `telegram_bot` \| `manual` \| `upload` \| `rss` \| `web` \| `obsidian`; `name`, `url` (для RSS), `config` (JSON), `is_enabled`, `last_checked_at`.

### ○ telegram_updates
| Поле | Тип | Примечание |
|---|---|---|
| update_id | bigint, **unique** | Отбрасывает повторную доставку |
| from_user_id | bigint | |
| kind | text | message, callback_query, message_reaction_count… |
| payload | text (JSON) | Сырое обновление без файлов |
| processed_at | datetime | |

### ● materials
| Поле | Тип | Примечание |
|---|---|---|
| source_id | → sources | |
| telegram_update_id | → telegram_updates, nullable | |
| type | text | `link` \| `text` \| `image` \| `video` \| `document` \| `voice` \| `forward` |
| status | text | `inbox` \| `processing` \| `ready` \| `failed` \| `archived` \| `deleted` |
| original_url | text | Как прислал автор |
| normalized_url_hash | text, **unique where not null** | Дедупликация ссылок |
| content_hash | text, index | sha256 текста или файла, для поиска похожих |
| title, source_author, source_name | text | Если доступны |
| source_published_at | datetime | Если доступна |
| owner_note | text | Комментарий автора при отправке |
| extracted_text | text | Извлечённый текст или расшифровка |
| summary | text | Краткое описание (AI или вручную) |
| category_id | → categories, nullable | |
| category_confidence | real | Уверенность Curator |
| topic, value_score | text, int | |
| processing_error | text | Последняя ошибка, без секретов |
| deleted_at | datetime | |

Ограничение: при совпадении `normalized_url_hash` новая запись не создаётся; повторная отправка добавляет `material_events` «прислано повторно» и заметку.

### ○ material_links
Связи между материалами и идеями. `from_type`, `from_id`, `to_type`, `to_id`, `relation` (`similar` \| `related` \| `duplicate_of`), `created_by` (`ai` \| `user`), `confirmed_by_user`. Уникальность по паре и типу связи.

### ● attachments
| Поле | Тип | Примечание |
|---|---|---|
| material_id / post_id / idea_id | nullable, ровно одно задано | |
| kind | text | image, video, audio, voice, document |
| storage_key | text | Путь в `storage/` |
| sha256 | text, index | Дедупликация файлов |
| mime, size_bytes, width, height, duration_sec | | |
| telegram_file_unique_id | text, index | Повторно присланный файл не скачивается заново |
| exif_stripped | bool | |
| sort_order | int | Порядок в альбоме |
| deleted_at | datetime | |

## 4. Идеи

### ● ideas
`text`, `status` (`open` \| `in_progress` \| `used` \| `dropped`), `category_id`, `project_name`, `origin_material_id` (nullable), `deleted_at`.

## 5. Публикации

### ● drafts
Рабочие версии текста. Отдельная таблица, чтобы хранить историю и варианты AI, не трогая сам пост.

| Поле | Тип | Примечание |
|---|---|---|
| post_id | → posts | |
| version | int | Уникально в паре (post_id, version) |
| body | text | Текст в формате Telegram HTML |
| title_variant | text | |
| origin | text | `user` \| `ai` \| `autosave` |
| ai_generation_id | → ai_generations, nullable | |

### ● posts
| Поле | Тип | Примечание |
|---|---|---|
| status | text | `draft` \| `review` \| `approved` \| `scheduled` \| `publishing` \| `published` \| `publish_unknown` \| `failed` \| `rejected` \| `archived` |
| channel_id | → channels | |
| category_id | → categories | |
| format | text | `text` \| `photo` \| `album` \| `video` \| `document` |
| current_draft_id | → drafts | |
| content_hash | text | sha256 текста + вложений + канала; сверяется с подтверждением |
| scheduled_at | datetime, nullable | |
| publish_attempt_id | text, **unique where not null** | Захват поста одним исполнителем |
| publish_lease_until | datetime | |
| telegram_message_ids | text (JSON) | Для альбома несколько |
| published_at, published_url | | |
| last_error | text | |

Связь с исходниками: `post_materials` (post_id, material_id, **unique** пара).

**Защита от повторной публикации:**
- Переход в `publishing` выполняется условным UPDATE `WHERE status IN ('approved','scheduled')`.
- `published` терминален: код не меняет статус обратно.
- Частичный уникальный индекс: не более одной записи `publish_attempts` в статусе `sent` на пост.

### ○ publish_attempts
`post_id`, `attempt_id` **unique**, `started_at`, `finished_at`, `outcome` (`sent` \| `rejected_by_telegram` \| `unknown` \| `rate_limited`), `telegram_error_code`, `error_text`, `message_ids`.

### ● approvals
| Поле | Тип | Примечание |
|---|---|---|
| post_id | → posts | |
| action | text | `approve` \| `reject` \| `revoke` \| `resolve_unknown_published` \| `resolve_unknown_resend` |
| user_id | → users | Кто подтвердил |
| via | text | `dashboard` \| `bot` |
| content_hash | text | Хеш подтверждённого содержимого |
| scheduled_for | datetime, nullable | |
| created_at | datetime | Когда |

Действующее подтверждение = последнее `approve` по посту, после которого нет `reject`/`revoke`, и `content_hash` совпадает с `posts.content_hash`.

### ● scheduled_posts
`post_id` **unique**, `scheduled_at`, `approval_id` → approvals (NOT NULL: без подтверждения в расписание не попасть), `status` (`waiting` \| `due` \| `done` \| `cancelled`), `rescheduled_count`. Перенос меняет `scheduled_at` и пишет событие в `activity_logs`.

## 6. AI

### ● ai_generations
`mode` (`curator` \| `editor` \| `researcher` \| `voice_analyzer` \| `strategist`), `provider`, `model`, `prompt_version`, `subject_type`, `subject_id`, `input_ref` (JSON: ссылки на объекты, не копия персональных данных), `output` (JSON), `status` (`ok` \| `invalid_output` \| `error`), `error`, `input_tokens`, `output_tokens`, `duration_ms`, `accepted_by_user` (nullable bool).

### ● style_profiles
`version` **unique**, `profile` (JSON: длина предложений, лексика, пунктуация, структура, юмор, разговорность, форматы, англицизмы), `source_post_ids` (JSON, только опубликованные и одобренные), `status` (`proposed` \| `active` \| `rejected`), `accepted_by_user_id`, `accepted_at`. Активен не более одного профиля; новый становится активным только действием владельца.

## 7. Аналитика

### ● analytics_snapshots
| Поле | Тип | Примечание |
|---|---|---|
| post_id | → posts, nullable | Null для метрик канала |
| channel_id | → channels | |
| metric | text | `views`, `forwards`, `reactions_total`, `reaction:<emoji>`, `subscribers` |
| value | int | |
| source | text | `bot_api` \| `manual_import` \| `mtproto` |
| captured_at | datetime | |
| import_batch_id | text, nullable | |

Уникальность (post_id, metric, source, captured_at). Отсутствующая метрика это отсутствие строки, а не ноль.

## 8. Служебное

### ○ jobs
`kind`, `status` (`queued` \| `running` \| `done` \| `failed` \| `cancelled`), `dedup_key` **unique where status in (queued, running)**, `payload` (JSON), `attempt`, `max_attempts`, `run_after`, `lease_until`, `locked_by`, `last_error`.

### ● activity_logs
`actor_type` (`user` \| `system` \| `ai` \| `bot`), `actor_user_id`, `action` (`material.created`, `post.approved`, `post.published`…), `entity_type`, `entity_id`, `before` / `after` (JSON, без секретов), `severity`, `created_at`. Только добавление.

### ● settings
`key` **unique**, `value` (JSON), `updated_by`. Несекретные настройки: AI-режимы, транскрибация вкл/выкл, хранить ли аудио, редакционный стиль, список запрещённых фраз, расписание бэкапов. Секреты (токены, ключи API) только в `.env` и в таблицу не попадают; признак «задано / не задано» вычисляется при запросе.

## 9. Индексы для частых запросов

- `materials (status, created_at desc)`, `materials (category_id, created_at)`
- `posts (status, scheduled_at)`, `posts (channel_id, published_at desc)`
- `jobs (status, run_after)`
- `activity_logs (entity_type, entity_id, created_at)`
- Полнотекстовый поиск: Этап 3 (FTS5 в SQLite или `tsvector` с русской морфологией в PostgreSQL).
