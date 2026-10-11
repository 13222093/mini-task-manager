export const ACTORS = ["john.doe", "jane.smith", "budi.santoso"] as const;

export type Actor = (typeof ACTORS)[number];
