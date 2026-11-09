export const MATERIAL_STATUSES = ["inbox", "processing", "ready", "failed", "archived", "deleted"] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

export const MATERIAL_TYPES = ["link", "text", "image", "video", "document", "voice", "forward"] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];

export const MATERIAL_STATUS_LABEL: Record<MaterialStatus, string> = {
  inbox: "Входящие",
  processing: "Обработка",
  ready: "Готово",
  failed: "Ошибка обработки",
  archived: "В архиве",
  deleted: "Удалено",
};
