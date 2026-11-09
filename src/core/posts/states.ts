export const POST_STATUSES = [
  "draft", "review", "approved", "scheduled", "publishing", "published", "publish_unknown", "failed", "rejected", "archived",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  draft: "Черновик",
  review: "На проверке",
  approved: "Подтверждён",
  scheduled: "Запланирован",
  publishing: "Публикуется",
  published: "Опубликован",
  publish_unknown: "Результат неизвестен",
  failed: "Ошибка публикации",
  rejected: "Отклонён",
  archived: "В архиве",
};

/**
 * Разрешённые переходы. publishing доступен только из approved/scheduled и только системе;
 * published терминален. Подтверждение (approved/scheduled) ставит только человек.
 */
const TRANSITIONS: Record<PostStatus, readonly PostStatus[]> = {
  draft: ["review", "archived", "rejected"],
  review: ["draft", "approved", "scheduled", "rejected", "archived"],
  approved: ["publishing", "review", "scheduled", "rejected"],
  scheduled: ["publishing", "review", "approved", "rejected"],
  publishing: ["published", "failed", "publish_unknown", "approved", "scheduled"],
  published: [],
  publish_unknown: ["published", "review"],
  failed: ["review", "draft", "archived"],
  rejected: ["draft", "archived"],
  archived: ["draft"],
};

export function canTransition(from: PostStatus, to: PostStatus) {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Недопустимый переход публикации: ${from} → ${to}`);
  }
}

export function assertTransition(from: string, to: PostStatus) {
  if (!(POST_STATUSES as readonly string[]).includes(from) || !canTransition(from as PostStatus, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/** Статусы, в которых текст можно редактировать. Правка подтверждённого поста снимает подтверждение. */
export const EDITABLE: readonly PostStatus[] = ["draft", "review", "approved", "scheduled", "failed", "rejected"];
