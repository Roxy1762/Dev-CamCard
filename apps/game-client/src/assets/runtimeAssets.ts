import Phaser from "phaser";

export const RUNTIME_ASSET_KEYS = {
  cardBackPlaceholder: "card-back-placeholder",
  cardArtPlaceholder: "card-art-placeholder",
  uiPlaceholder: "ui-placeholder",
} as const;

/**
 * 注册最小运行时占位资源。
 * 仅用于保证客户端在接入真实美术前可稳定 preload。
 */
export function preloadRuntimePlaceholders(loader: Phaser.Loader.LoaderPlugin): void {
  loader.svg(
    RUNTIME_ASSET_KEYS.cardBackPlaceholder,
    "assets/cards/backs/card-back-placeholder.svg"
  );

  loader.svg(
    RUNTIME_ASSET_KEYS.cardArtPlaceholder,
    "assets/cards/art/card-art-placeholder.svg"
  );

  loader.svg(RUNTIME_ASSET_KEYS.uiPlaceholder, "assets/ui/ui-placeholder.svg");
}
