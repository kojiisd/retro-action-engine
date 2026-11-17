import type { FrameView, PackRuntime } from '@retro-action-engine/core';
import type { LoadedRuntime } from '@retro-action-engine/pack';
import * as Phaser from 'phaser';
import { hudIcons } from './hud';
import { type Interpolation, interpolateSprites } from './interpolate';
import { tileLayerPlans } from './tile-layers';

export interface RendererOptions {
  readonly runtime: LoadedRuntime;
  /** The room to draw (one room per game as of M1-5). */
  readonly roomId: string;
  /** Party members in order, for the HUD. */
  readonly members: readonly string[];
  /**
   * Runs the simulation for one display frame and returns what to draw. Called from the scene's
   * `update` with Phaser's frame delta in ms (no smoothing). The renderer never steps the World.
   */
  readonly frame: (deltaMs: number) => FrameView;
  /** Interpolation of the current feel profile. */
  readonly interpolation: () => Interpolation;
  /** Called once the textures are loaded and the first frame can be drawn. */
  readonly onReady?: () => void;
}

/** Margin of the HUD icons inside the HUD band, in px. Layout only. */
const HUD_PAD = 2;
const HUD_INACTIVE_ALPHA = 0.4;

/**
 * The only scene. Phaser draws; it does not keep game time (`fps.smoothStep: false`, no physics,
 * no animations, no tweens, no Phaser input). Sprite frames come from the snapshot as they are.
 */
class GameScene extends Phaser.Scene {
  private readonly sprites = new Map<number, Phaser.GameObjects.Sprite>();
  private readonly hud: Phaser.GameObjects.Sprite[] = [];
  private hudCamera: Phaser.Cameras.Scene2D.Camera | undefined;
  private readonly world: Phaser.GameObjects.GameObject[] = [];

  constructor(private readonly options: RendererOptions) {
    super({ key: 'game' });
  }

  preload(): void {
    const { assets } = this.options.runtime;
    for (const [key, atlas] of Object.entries(assets.atlases)) {
      this.load.atlas(key, atlas.image, atlas.json);
    }
    for (const [key, tileset] of Object.entries(assets.tilesets)) {
      this.load.image(key, tileset.image);
    }
  }

  create(): void {
    const { runtime, roomId } = this.options;
    const { display, tileSize } = runtime;
    const top = display.hudReserve.top;
    const playHeight = display.height - top - display.hudReserve.bottom;
    const room = runtime.rooms[roomId];
    if (room === undefined) throw new RangeError(`room "${roomId}" is not in the pack`);

    for (const plan of tileLayerPlans(room, runtime.assets.tilesets)) {
      const map = this.make.tilemap({ data: plan.data, tileWidth: tileSize, tileHeight: tileSize });
      const tileset = map.addTilesetImage(plan.texture, plan.texture, tileSize, tileSize, 0, 0);
      if (tileset === null) throw new RangeError(`tileset "${plan.texture}" could not be added`);
      const layer = map.createLayer(0, tileset, 0, 0);
      layer.setDepth(plan.depth);
      this.world.push(layer);
    }

    // The play area sits under the HUD band; a second camera draws the HUD band itself.
    this.cameras.main.setViewport(0, top, display.width, playHeight);
    this.cameras.main.setRoundPixels(true);
    if (top > 0) {
      this.hudCamera = this.cameras.add(0, 0, display.width, top, false, 'hud');
      this.hudCamera.setRoundPixels(true);
      this.hudCamera.ignore(this.world);
    }
    this.options.onReady?.();
  }

  override update(_time: number, delta: number): void {
    const view = this.options.frame(delta);
    this.drawSprites(view);
    this.drawHud(view, this.options.runtime);
  }

  private drawSprites(view: FrameView): void {
    const draw = interpolateSprites(view.prev, view.curr, view.alpha, this.options.interpolation());
    const seen = new Set<number>();
    for (const s of draw) {
      seen.add(s.id);
      let sprite = this.sprites.get(s.id);
      if (sprite === undefined) {
        sprite = this.add.sprite(s.x, s.y, s.atlas, s.frame).setOrigin(0.5, 1);
        this.hudCamera?.ignore(sprite);
        this.sprites.set(s.id, sprite);
      }
      if (sprite.texture.key !== s.atlas) sprite.setTexture(s.atlas, s.frame);
      else if (sprite.frame.name !== s.frame) sprite.setFrame(s.frame);
      sprite.setPosition(s.x, s.y).setFlipX(s.flipX).setDepth(s.depth).setVisible(s.visible);
    }
    for (const [id, sprite] of this.sprites) {
      if (!seen.has(id)) {
        sprite.destroy();
        this.sprites.delete(id);
      }
    }
  }

  private drawHud(view: FrameView, runtime: PackRuntime): void {
    const camera = this.hudCamera;
    if (camera === undefined) return;
    const icons = hudIcons(view.ui, this.options.members, runtime);
    while (this.hud.length < icons.length) {
      const icon = this.add.sprite(0, 0, icons[0]?.atlas ?? '').setOrigin(0, 0);
      this.cameras.main.ignore(icon);
      this.hud.push(icon);
    }
    this.hud.forEach((sprite, i) => {
      const icon = icons[i];
      sprite.setVisible(icon !== undefined);
      if (icon === undefined) return;
      if (sprite.texture.key !== icon.atlas) sprite.setTexture(icon.atlas, icon.frame);
      else if (sprite.frame.name !== icon.frame) sprite.setFrame(icon.frame);
      // Icons are cropped to the band height from the top of the frame (head and shoulders).
      const size = camera.height - HUD_PAD * 2;
      sprite.setCrop(0, 0, sprite.frame.width, size);
      sprite.setPosition(HUD_PAD + i * (sprite.frame.width + HUD_PAD), HUD_PAD);
      sprite.setAlpha(icon.active ? 1 : HUD_INACTIVE_ALPHA);
    });
  }
}

/**
 * Starts Phaser in `parent` for a loaded pack. The canvas has the pack's display size and is
 * scaled to fit with whole pixels kept sharp. Returns a function that tears the game down.
 */
export function startRenderer(parent: HTMLElement, options: RendererOptions): () => void {
  const { display } = options.runtime;
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: display.width,
    height: display.height,
    pixelArt: true,
    backgroundColor: '#000000',
    banner: false,
    // Input comes from the `input` package (docs/input-and-feel.md 3.4); Phaser's is off.
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    audio: { noAudio: true },
    fps: { smoothStep: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: new GameScene(options),
  });
  return () => game.destroy(true);
}
