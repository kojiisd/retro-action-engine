import type { FrameView, PackRuntime } from '@retro-action-engine/core';
import type { LoadedRuntime } from '@retro-action-engine/pack';
import * as Phaser from 'phaser';
import { HUD_PAD, hudIcons, hudLayout } from './hud';
import {
  type Interpolation,
  interpolateColliders,
  interpolateHitboxes,
  interpolateSprites,
} from './interpolate';
import { integerZoom, type Scaling } from './scaling';
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
  /** Debug display (dev and PR previews only): draw the collision boxes. Read every frame. */
  readonly showColliders?: () => boolean;
  /** Called after each frame is drawn (the debug latency display measures from input to here). */
  readonly afterDraw?: () => void;
  /** A desynchronized canvas context (lower latency on some devices; measured in M2-3). */
  readonly desynchronized?: boolean;
  /** How the screen is scaled in `parent` (ADR-0010). Stretched to fit when absent. */
  readonly scaling?: Scaling;
}

/** Debug collision boxes: a thin line above everything in the play area. */
const COLLIDER_COLOR = 0x40ff90;
/** Debug attack hitboxes (ADR-0017), in another color than the bodies. */
const HITBOX_COLOR = 0xff5040;
const COLLIDER_DEPTH = 100;

const HUD_INACTIVE_ALPHA = 0.4;
/** A member whose HP is 0 (ADR-0016): darker than one that is only not active. */
const HUD_DOWN_ALPHA = 0.15;
/** The HP gauge: left and lost (ADR-0016; no image, no text). */
const HP_FULL_COLOR = 0xff6b6b;
const HP_LOST_COLOR = 0x4a2b2b;

/**
 * The only scene. Phaser draws; it does not keep game time (`fps.smoothStep: false`, no physics,
 * no animations, no tweens, no Phaser input). Sprite frames come from the snapshot as they are.
 */
class GameScene extends Phaser.Scene {
  private readonly sprites = new Map<number, Phaser.GameObjects.Sprite>();
  private readonly hud: Phaser.GameObjects.Sprite[] = [];
  private hudCamera: Phaser.Cameras.Scene2D.Camera | undefined;
  private hpCells: Phaser.GameObjects.Graphics | undefined;
  private readonly world: Phaser.GameObjects.GameObject[] = [];
  private debug: Phaser.GameObjects.Graphics | undefined;

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
    this.debug = this.add.graphics().setDepth(COLLIDER_DEPTH);
    this.hudCamera?.ignore(this.debug);
    if (this.hudCamera !== undefined) {
      this.hpCells = this.add.graphics();
      this.cameras.main.ignore(this.hpCells);
    }
    this.options.onReady?.();
  }

  override update(_time: number, delta: number): void {
    const view = this.options.frame(delta);
    this.drawSprites(view);
    this.drawColliders(view);
    this.drawHud(view, this.options.runtime);
    this.options.afterDraw?.();
  }

  private drawColliders(view: FrameView): void {
    const g = this.debug;
    if (g === undefined) return;
    g.clear();
    if (this.options.showColliders?.() !== true) return;
    g.lineStyle(1, COLLIDER_COLOR, 1);
    const boxes = interpolateColliders(
      view.prev,
      view.curr,
      view.alpha,
      this.options.interpolation(),
    );
    // Half-pixel inset so a 1 px line sits on the box's edge pixels.
    for (const b of boxes) g.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    g.lineStyle(1, HITBOX_COLOR, 1);
    const hits = interpolateHitboxes(
      view.prev,
      view.curr,
      view.alpha,
      this.options.interpolation(),
    );
    for (const b of hits) g.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
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
    });
    const alphaOf = (i: number) => {
      const icon = icons[i];
      if (icon === undefined) return 1;
      if (!icon.alive) return HUD_DOWN_ALPHA;
      return icon.active ? 1 : HUD_INACTIVE_ALPHA;
    };
    const layout = hudLayout(
      icons,
      icons.map((_, i) => this.hud[i]?.frame.width ?? 0),
      camera.height,
    );
    layout.icons.forEach((at, i) => {
      this.hud[i]?.setPosition(at.x, at.y).setAlpha(alphaOf(i));
    });
    // HP: a gauge per member, the lost part dark.
    const gauges = this.hpCells;
    if (gauges === undefined) return;
    gauges.clear();
    for (const bar of layout.bars) {
      // Readable for every living member, active or not; dark once the member is down.
      const alpha = icons[bar.icon]?.alive === false ? HUD_DOWN_ALPHA : 1;
      gauges.fillStyle(HP_LOST_COLOR, alpha);
      gauges.fillRect(bar.x + bar.fill, bar.y, bar.w - bar.fill, bar.h);
      gauges.fillStyle(HP_FULL_COLOR, alpha);
      gauges.fillRect(bar.x, bar.y, bar.fill, bar.h);
    }
  }
}

/**
 * Starts Phaser in `parent` for a loaded pack. The canvas has the pack's display size and is
 * scaled in `parent` as `options.scaling` says, with whole pixels kept sharp. Returns a function
 * that tears the game down.
 */
export function startRenderer(parent: HTMLElement, options: RendererOptions): () => void {
  const { display } = options.runtime;
  const scaling = options.scaling ?? { kind: 'fit' };
  // A whole zoom, worked out from the parent's size and set again whenever it changes.
  const zoomFor = (maxZoom: number) =>
    integerZoom(display.width, display.height, parent.clientWidth, parent.clientHeight, maxZoom);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: display.width,
    height: display.height,
    pixelArt: true,
    backgroundColor: '#000000',
    banner: false,
    desynchronized: options.desynchronized === true,
    // Input comes from the `input` package (docs/input-and-feel.md 3.4); Phaser's is off.
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    audio: { noAudio: true },
    fps: { smoothStep: false },
    scale:
      scaling.kind === 'fit'
        ? { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }
        : {
            mode: Phaser.Scale.NONE,
            zoom: zoomFor(scaling.maxZoom),
            autoCenter: Phaser.Scale.CENTER_BOTH,
          },
    scene: new GameScene(options),
  });
  let observer: ResizeObserver | undefined;
  if (scaling.kind === 'integer' && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      const zoom = zoomFor(scaling.maxZoom);
      if (zoom !== game.scale.zoom) game.scale.setZoom(zoom);
    });
    observer.observe(parent);
  }
  return () => {
    observer?.disconnect();
    game.destroy(true);
  };
}
