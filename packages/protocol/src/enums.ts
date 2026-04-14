/**
 * 基础枚举与字面量类型
 */

/** 对战双方席位 — 先手为 0，后手为 1 */
export type PlayerSide = 0 | 1;

/** 卡牌规则类型 */
export type CardType = "action" | "venue";

/** 场馆子类型 */
export type VenueKind = "normal" | "guard";

/** 商店栏（三栏商店） */
export type Lane = "course" | "activity" | "daily";

/** 卡牌稀有度 */
export type Rarity = "common" | "advanced" | "signature";
