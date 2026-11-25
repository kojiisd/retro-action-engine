import type { FrameView, PackRuntime } from '@retro-action-engine/core';
import { glyphIndex, type LoadedRuntime, layoutText } from '@retro-action-engine/pack';
import * as Phaser from 'phaser';
import { fadeAmount } from './fade';
import { HUD_PAD, hudIcons, hudLayout } from './hud';
import {
  type Interpolation,
  interpolateCamera,
  interpolateColliders,
  interpolateHitboxes,
  interpolateSprites,
} from './interpolate';
import { colorOf, type OverlayView } from './overlay';
import { integerZoom, type Scaling } from './scaling';
import { tileLayerPlans } from './tile-layers';

export interface RendererOptions {
  readonly runtime: LoadedRuntime;
  /** The room to draw first; after that, the room of each snapshot (ADR-0018). */
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
  /** The in-game menu over everything (ADR-0020), read every frame; null when it is closed. */
  readonly overlay?: () => OverlayView | null;
}

/** Texture key of the menu font (ADR-0020). */
const MENU_FONT = '__menu_font';

/** Debug collision boxes: a thin line above everything in the play area. */
const COLLIDER_COLOR = 0x40ff90;
/** Debug attack hitboxes (ADR-0017), in another color than the bodies. */
const HITBOX_COLOR = 0xff5040;
const COLLIDER_DEPTH = 100;
/** The room-change fade (ADR-0018): over everything in the play area, not over the HUD. */
const FADE_COLOR = 0x000000;
const FADE_DEPTH = 200;

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
  private maps: Phaser.Tilemaps.Tilemap[] = [];
  private roomId = '';
  private debug: Phaser.GameObjects.Graphics | undefined;
  private fade: Phaser.GameObjects.Rectangle | undefined;
  /** The menu (ADR-0020): its own camera over the whole display, and pooled objects. */
  private overlayCamera: Phaser.Cameras.Scene2D.Camera | undefined;
  private overlayShapes: Phaser.GameObjects.Graphics | undefined;
  private readonly overlayGlyphs: Phaser.GameObjects.Image[] = [];
  private readonly overlaySprites: Phaser.GameObjects.Sprite[] = [];
  private glyphOf: ((ch: string) => number) | undefined;

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
    const font = this.options.runtime.ui?.font;
    if (font !== undefined) {
      this.load.spritesheet(MENU_FONT, font.image, {
        frameWidth: font.cellW,
        frameHeight: font.cellH,
      });
    }
  }

  create(): void {
    const { runtime, roomId } = this.options;
    const { display } = runtime;
    const top = display.hudReserve.top;
    const playHeight = display.height - top - display.hudReserve.bottom;

    // The play area sits under the HUD band; a second camera draws the HUD band itself.
    this.cameras.main.setViewport(0, top, display.width, playHeight);
    this.cameras.main.setRoundPixels(true);
    if (top > 0) {
      this.hudCamera = this.cameras.add(0, 0, display.width, top, false, 'hud');
      this.hudCamera.setRoundPixels(true);
    }
    this.showRoom(roomId);
    this.debug = this.add.graphics().setDepth(COLLIDER_DEPTH);
    this.hudCamera?.ignore(this.debug);
    this.fade = this.add
      .rectangle(0, 0, display.width, playHeight, FADE_COLOR, 1)
      .setOrigin(0, 0)
      .setDepth(FADE_DEPTH)
      .setScrollFactor(0)
      .setAlpha(0);
    this.hudCamera?.ignore(this.fade);
    if (this.hudCamera !== undefined) {
      this.hpCells = this.add.graphics();
      this.cameras.main.ignore(this.hpCells);
    }
    // The menu: drawn by a camera of its own over the whole display, above the others.
    if (this.options.overlay !== undefined) {
      this.overlayCamera = this.cameras.add(0, 0, display.width, display.height, false, 'overlay');
      this.overlayCamera.setRoundPixels(true);
      // Everything made so far (tiles, debug lines, the fade, the HUD gauges) is not the menu's.
      this.overlayCamera.ignore(this.children.list);
      this.overlayShapes = this.add.graphics();
      this.onlyOnOverlay(this.overlayShapes);
      const font = runtime.ui?.font;
      if (font !== undefined) this.glyphOf = glyphIndex(font);
    }
    this.options.onReady?.();
  }

  /** Draws `object` with the menu's camera only, and keeps it off the menu's camera otherwise. */
  private onlyOnOverlay(object: Phaser.GameObjects.GameObject): void {
    this.cameras.main.ignore(object);
    this.hudCamera?.ignore(object);
  }

  /** Builds the tile layers of a room, in place of the previous room's. */
  private showRoom(roomId: string): void {
    const { runtime } = this.options;
    const { tileSize } = runtime;
    const room = runtime.rooms[roomId];
    if (room === undefined) throw new RangeError(`room "${roomId}" is not in the pack`);
    for (const map of this.maps) map.destroy();
    this.maps = [];
    for (const plan of tileLayerPlans(room, runtime.assets.tilesets)) {
      const map = this.make.tilemap({ data: plan.data, tileWidth: tileSize, tileHeight: tileSize });
      const tileset = map.addTilesetImage(plan.texture, plan.texture, tileSize, tileSize, 0, 0);
      if (tileset === null) throw new RangeError(`tileset "${plan.texture}" could not be added`);
      const layer = map.createLayer(0, tileset, 0, 0);
      layer.setDepth(plan.depth);
      this.hudCamera?.ignore(layer);
      this.overlayCamera?.ignore(layer);
      this.maps.push(map);
    }
    this.roomId = roomId;
  }

  override update(_time: number, delta: number): void {
    const view = this.options.frame(delta);
    if (view.curr.room !== this.roomId) this.showRoom(view.curr.room);
    const camera = interpolateCamera(
      view.prev,
      view.curr,
      view.alpha,
      this.options.interpolation(),
    );
    this.cameras.main.setScroll(camera.x, camera.y);
    this.fade?.setAlpha(fadeAmount(view.transition));
    this.drawSprites(view);
    this.drawColliders(view);
    this.drawHud(view, this.options.runtime);
    this.drawOverlay(this.options.overlay?.() ?? null);
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
        this.overlayCamera?.ignore(sprite);
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
      this.overlayCamera?.ignore(icon);
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

  /** The menu (ADR-0020): a dark veil, the windows, the text and the pictures. */
  private drawOverlay(view: OverlayView | null): void {
    const g = this.overlayShapes;
    if (g === undefined) return;
    g.clear();
    const used = { glyphs: 0, sprites: 0 };
    if (view !== null) {
      const { display } = this.options.runtime;
      if (view.dim > 0) {
        g.fillStyle(0x000000, view.dim);
        g.fillRect(0, 0, display.width, display.height);
      }
      for (const r of view.rects) {
        g.fillStyle(colorOf(r.color), 1);
        g.fillRect(r.x, r.y, r.w, r.h);
      }
      const font = this.options.runtime.ui?.font;
      if (font !== undefined && this.glyphOf !== undefined) {
        for (const t of view.texts) {
          for (const glyph of layoutText(font, t.text, t.x, t.y, this.glyphOf)) {
            let image = this.overlayGlyphs[used.glyphs];
            if (image === undefined) {
              image = this.add.image(0, 0, MENU_FONT, 0).setOrigin(0, 0).setDepth(2);
              this.onlyOnOverlay(image);
              this.overlayGlyphs.push(image);
            }
            used.glyphs++;
            image.setFrame(glyph.cell).setPosition(glyph.x, glyph.y).setTint(colorOf(t.color));
            image.setVisible(true);
          }
        }
      }
      for (const s of view.sprites) {
        let sprite = this.overlaySprites[used.sprites];
        if (sprite === undefined) {
          sprite = this.add.sprite(0, 0, s.atlas, s.frame).setOrigin(0, 0).setDepth(1);
          this.onlyOnOverlay(sprite);
          this.overlaySprites.push(sprite);
        }
        used.sprites++;
        if (sprite.texture.key !== s.atlas) sprite.setTexture(s.atlas, s.frame);
        else if (sprite.frame.name !== s.frame) sprite.setFrame(s.frame);
        sprite
          .setPosition(s.x, s.y)
          .setAlpha(s.alpha ?? 1)
          .setVisible(true);
      }
    }
    for (let i = used.glyphs; i < this.overlayGlyphs.length; i++) {
      this.overlayGlyphs[i]?.setVisible(false);
    }
    for (let i = used.sprites; i < this.overlaySprites.length; i++) {
      this.overlaySprites[i]?.setVisible(false);
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
